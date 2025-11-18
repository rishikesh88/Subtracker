# OAuth Setup Guide

This guide explains how to set up Google and Microsoft OAuth authentication for SubTracker.

## Prerequisites

- A Replit project with SubTracker deployed
- Admin access to Google Cloud Console and/or Azure Portal
- Your Replit app's public URL (found in the Replit IDE)

---

## Google OAuth Setup

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name (e.g., "SubTracker OAuth")
4. Click "Create"

### Step 2: Configure OAuth Consent Screen

1. In the left sidebar, go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type
3. Click **Create**
4. Fill in the required fields:
   - **App name**: SubTracker
   - **User support email**: Your email
   - **Developer contact email**: Your email
5. Click **Save and Continue**
6. Skip adding scopes (click **Save and Continue**)
7. Add test users if needed
8. Click **Save and Continue** → **Back to Dashboard**

### Step 3: Create OAuth Client ID

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: "SubTracker Web Client"
5. **Authorized JavaScript origins**:
   - Add your Replit app URL: `https://your-app-name.replit.app`
6. **Authorized redirect URIs**:
   - Add: `https://your-app-name.replit.app/api/auth/google-login/callback`
7. Click **Create**
8. **Copy the Client ID and Client Secret** (you'll need these next)

### Step 4: Add Secrets to Replit

1. In your Replit IDE, click the **Secrets** (lock icon) in the sidebar
2. Add the following secrets:
   - **Key**: `GOOGLE_AUTH_CLIENT_ID`
     **Value**: [Paste your Google Client ID]
   - **Key**: `GOOGLE_AUTH_CLIENT_SECRET`
     **Value**: [Paste your Google Client Secret]
3. Click **Add secret** for each one

---

## Microsoft OAuth Setup

### Step 1: Register an Application in Azure

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to **Azure Active Directory** (or **Microsoft Entra ID**)
3. Click **App registrations** → **New registration**
4. Fill in the details:
   - **Name**: SubTracker
   - **Supported account types**: Accounts in any organizational directory and personal Microsoft accounts
   - **Redirect URI**: Select **Web** and enter:
     `https://your-app-name.replit.app/api/auth/microsoft-login/callback`
5. Click **Register**

### Step 2: Create a Client Secret

1. In your app registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Description: "SubTracker Web Client"
4. Expires: Choose your preferred expiration (24 months recommended)
5. Click **Add**
6. **Copy the Value immediately** (you won't be able to see it again!)

### Step 3: Copy Application (Client) ID

1. Go to the **Overview** page of your app registration
2. Copy the **Application (client) ID**
3. Copy the **Directory (tenant) ID** (optional - only needed for work/school accounts)

### Step 4: Configure API Permissions

1. Go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Delegated permissions**
5. Add these permissions:
   - `openid`
   - `profile`
   - `email`
   - `User.Read`
6. Click **Add permissions**
7. Click **Grant admin consent for [Your Organization]** (if you're an admin)

### Step 5: Add Secrets to Replit

1. In your Replit IDE, click the **Secrets** (lock icon) in the sidebar
2. Add the following secrets:
   - **Key**: `MICROSOFT_AUTH_CLIENT_ID`
     **Value**: [Paste your Application (client) ID]
   - **Key**: `MICROSOFT_AUTH_CLIENT_SECRET`
     **Value**: [Paste your Client Secret Value]
   - **Key**: `MICROSOFT_AUTH_TENANT_ID` (optional)
     **Value**: [Paste your Directory (tenant) ID or use "common" for all accounts]
3. Click **Add secret** for each one

---

## Testing OAuth Setup

### Test Google Login

1. Restart your Replit app
2. Navigate to your app's `/login` page
3. Click "Sign in with Google"
4. You should be redirected to Google's login page
5. Sign in with a Google account
6. Grant permissions
7. You should be redirected back to SubTracker

### Test Microsoft Login

1. Navigate to `/login`
2. Click "Sign in with Microsoft"
3. You should be redirected to Microsoft's login page
4. Sign in with a Microsoft account (personal or work/school)
5. Grant permissions
6. You should be redirected back to SubTracker

---

## Troubleshooting

### Google OAuth Issues

**Error: "redirect_uri_mismatch"**
- Solution: Double-check that your redirect URI in Google Cloud Console exactly matches:
  `https://your-app-name.replit.app/api/auth/google-login/callback`

**Error: "Access blocked: This app's request is invalid"**
- Solution: Make sure you've configured the OAuth consent screen

### Microsoft OAuth Issues

**Error: "AADSTS50011: The reply URL specified in the request does not match"**
- Solution: Verify your redirect URI in Azure Portal matches:
  `https://your-app-name.replit.app/api/auth/microsoft-login/callback`

**Error: "AADSTS65001: The user or administrator has not consented"**
- Solution: Make sure you've added the required permissions and granted admin consent (if applicable)

### General Issues

**"OAuth credentials not configured"**
- Solution: Check that you've added all required secrets to Replit and restarted the app

**"Session creation failed"**
- Solution: Clear your browser cookies and try again

---

## Security Best Practices

1. **Keep secrets secure**: Never commit Client IDs or Secrets to version control
2. **Use HTTPS**: Always use HTTPS in production (Replit provides this automatically)
3. **Limit redirect URIs**: Only add the specific callback URLs you need
4. **Rotate secrets regularly**: Update your client secrets periodically
5. **Monitor access**: Review OAuth consent grants in Google/Microsoft admin panels

---

## Next Steps

After setting up OAuth:
1. Test both Google and Microsoft login flows
2. Verify user data is being stored correctly
3. Test the complete onboarding flow (org setup → connect email → sync)
4. Monitor logs for any authentication errors

For questions or issues, check the Replit logs or contact support.
