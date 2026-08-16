import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

// Service account credentials are supplied as inline JSON rather than a key
// file path: the runtime has no persistent filesystem to mount a key onto.
// Falling back to Application Default Credentials keeps local development
// working via `gcloud auth application-default login`.
function buildStorageClient(): Storage {
  const inlineCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const projectId = process.env.GCS_PROJECT_ID;

  if (!inlineCredentials) {
    return new Storage(projectId ? { projectId } : {});
  }

  let credentials;
  try {
    credentials = JSON.parse(inlineCredentials);
  } catch (error) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON. It must contain " +
        "the full service account key, not a file path."
    );
  }

  return new Storage({
    credentials,
    projectId: projectId || credentials.project_id,
  });
}

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = buildStorageClient();

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  // Gets the private object directory.
  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set it to /<bucket-name>/<prefix> for " +
          "the Cloud Storage bucket holding private objects."
      );
    }
    return dir;
  }

  // Downloads an object to the response.
  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      // Get file metadata
      const [metadata] = await file.getMetadata();
      // Get the ACL policy for the object.
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      // Set appropriate headers
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      // Stream the file to the response
      const stream = file.createReadStream();

      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });

      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Gets the upload URL for an object entity.
  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Set it to /<bucket-name>/<prefix> for " +
          "the Cloud Storage bucket holding private objects."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Sign URL for PUT method with TTL
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  /**
   * Upload a buffer directly to object storage
   * Returns the normalized /objects/... path
   */
  async uploadBufferToObject(
    fullPath: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string> {
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    // Upload the buffer
    await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
      metadata: {
        cacheControl: 'private'
      }
    });

    // Return normalized path
    return this.normalizeObjectEntityPath(`https://storage.googleapis.com/${bucketName}/${objectName}`);
  }

  /**
   * Upload buffer and set ACL policy in one operation
   * Convenience wrapper for invoiceExtractor and similar services
   */
  async uploadBufferWithAcl(
    fullPath: string,
    buffer: Buffer,
    mimeType: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = await this.uploadBufferToObject(fullPath, buffer, mimeType);
    const file = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(file, aclPolicy);
    return normalizedPath;
  }

  /**
   * Delete an object from object storage
   * @param fullPath - Full path like "PRIVATE_OBJECT_DIR/uploads/filename"
   */
  async deleteObject(fullPath: string): Promise<void> {
    try {
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Check if file exists before attempting to delete
      const [exists] = await file.exists();
      if (exists) {
        await file.delete();
        console.log(`Successfully deleted object: ${fullPath}`);
      } else {
        console.warn(`Object not found for deletion: ${fullPath}`);
      }
    } catch (error) {
      console.error(`Error deleting object ${fullPath}:`, error);
      throw error;
    }
  }

  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(
    rawPath: string,
  ): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
  
    // Extract the path from the URL by removing query parameters and domain
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
  
    let objectEntityDir = this.getPrivateObjectDir();
    // Ensure objectEntityDir has a leading slash for comparison
    if (!objectEntityDir.startsWith("/")) {
      objectEntityDir = `/${objectEntityDir}`;
    }
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
  
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
  
    // Extract the entity ID from the path
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

const SIGNED_URL_ACTIONS = {
  GET: "read",
  HEAD: "read",
  PUT: "write",
  DELETE: "delete",
} as const;

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const [signedURL] = await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .getSignedUrl({
      version: "v4",
      action: SIGNED_URL_ACTIONS[method],
      expires: Date.now() + ttlSec * 1000,
    });

  return signedURL;
}
