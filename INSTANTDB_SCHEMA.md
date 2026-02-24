# InstantDB schema (required for sync)

The app uses InstantDB `lookup()` so entity IDs are not plain strings. **Lookup requires each lookup attribute to be marked unique in the schema.** Until this schema is pushed, writes can fail with validation errors and other devices will not see assignments.

## One-time setup: push the schema

1. **App ID**  
   Use the same value as in `data/config.json`: `instantAppId` (e.g. `c3ff5491-db2a-4c19-a43b-15a56d52ed8a`).

2. **Environment**  
   In the project root, create a `.env` file (or set in your shell):
   ```bash
   INSTANT_APP_ID=c3ff5491-db2a-4c19-a43b-15a56d52ed8a
   ```
   Replace with your actual `instantAppId` from `data/config.json`.

3. **Install CLI dependency**  
   So the schema file can be loaded and pushed:
   ```bash
   npm init -y
   npm install @instantdb/react
   ```

4. **Log in and push**  
   ```bash
   npx instant-cli@latest login
   npx instant-cli@latest push schema
   ```
   When prompted, confirm the schema changes.

After a successful push, all devices can write and read assignments and station data; no code changes are required.
