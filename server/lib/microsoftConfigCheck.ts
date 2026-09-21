/**
 * Is the Azure setup still good?
 *
 * "I set this up months ago and I am not sure it is still active" is the
 * normal state of an app registration: client secrets expire, most within two
 * years, and nothing announces it. The failure that follows happens on
 * Microsoft's own sign-in page, which our logs never see, so from inside the
 * app it looks like the user simply changed their mind.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 *
 * It asks Microsoft's authorize endpoint about the client ID, without signing
 * anyone in. Microsoft answers with an HTML sign-in page that carries an error
 * code in its inline config, and that code separates two cases:
 *
 *   50058  Microsoft knows this application and wants a user to sign in.
 *          The client ID is good.
 *   50059  Microsoft cannot resolve the application at all.
 *          The client ID is wrong, or the app was deleted.
 *
 * It CANNOT check the client secret, and it cannot confirm the redirect URI.
 * Microsoft validates the secret only when a real authorization code is
 * exchanged, and the redirect URI only after a user has signed in -- neither
 * of which can be reached without a person at a keyboard.
 *
 * An earlier version of this file claimed to test the secret by exchanging a
 * deliberately invalid code, on the theory that the client is authenticated
 * before the code is examined. Microsoft rejects the malformed code first
 * (AADSTS9002313) and never looks at the credentials, so that check reported
 * a made-up client ID and secret as working. Hence the narrower promise here.
 */

export type CheckStatus = "ok" | "unconfigured" | "bad_client_id" | "unreachable";

export interface AppCheck {
  /** Which registration this is, in the user's terms. */
  name: string;
  status: CheckStatus;
  /** One sentence, written to be acted on rather than searched for. */
  detail: string;
  /** Environment variables this registration reads, and whether each is set. */
  variables: { name: string; set: boolean }[];
  /** The redirect URI this server sends. Must match Azure character for character. */
  redirectUri: string;
  /** The permissions this registration asks for. */
  scopes: string[];
  /** Microsoft's own code, when it gave one. Worth quoting in a search. */
  code?: string;
  /**
   * The client ID in full.
   *
   * Shown, unlike the secret, because it is not one: it travels in the query
   * string of every sign-in and is visible to anyone who watches the browser.
   * Hiding it only makes "is this variable pointing at the app I am editing?"
   * impossible to answer, which is the question that matters when someone has
   * more than one registration.
   */
  clientId?: string;
  /** Stated on the page so the check is never read as proving more than it does. */
  notChecked: string[];
}

const NOT_CHECKED = [
  "Whether the client secret is still valid — Microsoft only tests that when someone actually signs in. If connecting fails at the very last step, an expired secret is the first thing to renew.",
  "Whether the redirect URI below is registered — Microsoft only checks that after sign-in. Compare it against Azure by eye.",
  "Which account types the app allows. If connecting fails with \"not enabled for consumers\", set Supported account types in Azure to include personal Microsoft accounts — and make sure you are editing the app whose client ID is shown here.",
];

async function probeClientId(
  authority: string,
  clientId: string,
  redirectUri: string,
  scopes: string[]
): Promise<{ status: CheckStatus; detail: string; code?: string }> {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: scopes.join(" "),
  });

  let body: string;
  try {
    const response = await fetch(`${authority}/oauth2/v2.0/authorize?${params}`, {
      redirect: "manual",
    });
    body = await response.text();
  } catch (error) {
    return {
      status: "unreachable",
      detail: `Could not reach Microsoft: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }

  const code = body.match(/sErrorCode":"(\d+)"/)?.[1];

  // No error at all means Microsoft went straight to asking for a sign-in.
  if (!code || code === "50058") {
    return {
      status: "ok",
      detail:
        "Microsoft recognises this application. Check the client ID below against the app you have been editing in Azure — this only proves some app with that ID exists, not that it is the right one.",
    };
  }

  if (code === "50059" || code === "700016" || code === "700027") {
    return {
      status: "bad_client_id",
      detail:
        "Microsoft does not recognise this application. Check the client ID against the Application (client) ID in Azure, and that the registration still exists.",
      code: `AADSTS${code}`,
    };
  }

  if (code === "900023" || code === "90002") {
    return {
      status: "bad_client_id",
      detail: "Microsoft does not recognise the tenant this is pointed at.",
      code: `AADSTS${code}`,
    };
  }

  if (code === "650053" || code === "70011") {
    return {
      status: "bad_client_id",
      detail:
        "The application exists, but Microsoft rejected the permissions it asks for. Check the API permissions in Azure.",
      code: `AADSTS${code}`,
    };
  }

  return {
    status: "bad_client_id",
    detail: `Microsoft refused the request with code AADSTS${code}.`,
    code: `AADSTS${code}`,
  };
}

/**
 * Both registrations, checked. Never returns a secret or any part of one.
 */
export async function checkMicrosoftConfig(appBaseUrl: string): Promise<AppCheck[]> {
  const registrations = [
    {
      name: "Outlook mailbox access",
      clientId: process.env.MICROSOFT_CLIENT_ID,
      // Fixed to /common so personal Microsoft accounts can connect too.
      authority: "https://login.microsoftonline.com/common",
      redirectUri:
        process.env.MICROSOFT_REDIRECT_URI || `${appBaseUrl}/api/auth/outlook/callback`,
      variables: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
      scopes: [
        "https://graph.microsoft.com/Mail.Read",
        "https://graph.microsoft.com/User.Read",
        "offline_access",
      ],
    },
    {
      name: "Sign in with Microsoft",
      clientId: process.env.MICROSOFT_AUTH_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_AUTH_TENANT_ID || "common"}`,
      redirectUri: `${appBaseUrl}/api/auth/microsoft-login/callback`,
      variables: ["MICROSOFT_AUTH_CLIENT_ID", "MICROSOFT_AUTH_CLIENT_SECRET"],
      scopes: ["openid", "profile", "email", "User.Read"],
    },
  ];

  return Promise.all(
    registrations.map(async (registration): Promise<AppCheck> => {
      const variables = registration.variables.map((name) => ({
        name,
        set: Boolean(process.env[name]),
      }));

      const missing = variables.filter((v) => !v.set).map((v) => v.name);
      if (missing.length > 0) {
        return {
          name: registration.name,
          status: "unconfigured",
          detail: `Not set up yet: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing.`,
          variables,
          redirectUri: registration.redirectUri,
          scopes: registration.scopes,
          clientId: registration.clientId || undefined,
          notChecked: [],
        };
      }

      const result = await probeClientId(
        registration.authority,
        registration.clientId!,
        registration.redirectUri,
        registration.scopes
      );

      return {
        name: registration.name,
        ...result,
        variables,
        redirectUri: registration.redirectUri,
        scopes: registration.scopes,
        clientId: registration.clientId,
        notChecked: result.status === "ok" ? NOT_CHECKED : [],
      };
    })
  );
}

/**
 * Microsoft-ish variables this server has, that are NOT the ones it reads.
 *
 * The common failure when a setup page says "missing" but the person is sure
 * they set it: the values are there under different names. Azure's own portal
 * calls them "Application (client) ID" and "Client secret", so they get saved
 * as AZURE_CLIENT_ID, MS_CLIENT_SECRET, OUTLOOK_CLIENT_ID and so on, and the
 * code reading MICROSOFT_CLIENT_ID never sees them.
 *
 * Names only, never values. A name is not a secret; a value always is. The
 * scan is limited to a pattern rather than listing the whole environment,
 * because the rest of it is nobody's business even on an admin page.
 */
export function relatedVariableNames(): string[] {
  const alreadyReported = new Set([
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_AUTH_CLIENT_ID",
    "MICROSOFT_AUTH_CLIENT_SECRET",
  ]);

  return Object.keys(process.env)
    .filter((name) => /MICROSOFT|AZURE|ENTRA|OUTLOOK|GRAPH|^MS_/i.test(name))
    .filter((name) => !alreadyReported.has(name))
    .filter((name) => Boolean(process.env[name]))
    .sort();
}
