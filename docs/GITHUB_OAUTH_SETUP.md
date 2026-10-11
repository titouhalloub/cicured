# GitHub OAuth App setup

The API needs an OAuth App's client ID and secret to handle user
login (distinct from the GitHub App, which handles repo access).

## 1. Register the OAuth App

1. Open https://github.com/settings/developers
2. Click **New OAuth App**
3. Fill in:
   - **Application name:** `cicured-dev`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:**
     `http://localhost:4000/auth/github/callback`
4. Click **Register application**
5. Copy the **Client ID**
6. Click **Generate a new client secret** and copy it

## 2. Configure the API

Add to `.env`:

    GITHUB_CLIENT_ID=<the client ID>
    GITHUB_CLIENT_SECRET=<the client secret>

Restart the API. The `GET /auth/github` endpoint now redirects to a
real GitHub authorize page instead of returning 503.

## 3. Production

For a deployed instance, create a second OAuth App with:

- **Homepage URL:** `https://<your-domain>`
- **Authorization callback URL:**
  `https://api.<your-domain>/auth/github/callback`

Keep the dev and prod client credentials in separate `.env` files.

## What this is not

This is the *OAuth App* for user login. It is separate from the
*GitHub App* (registered at https://github.com/settings/apps) which
mints installation tokens for repo access. Both are required for a
complete setup — see `deploy/README.md`.
