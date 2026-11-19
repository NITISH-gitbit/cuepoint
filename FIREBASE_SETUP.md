# Set up Firebase sync for CuePoint

CuePoint works without an account. By default, your timestamp bookmarks and notes stay in Firefox on the device where you saved them. Follow this guide only if you want to sync them across devices through **your own Firebase project**. In CuePoint, this option is called **Cloud (BYOC)**, short for “bring your own cloud.”

| You’ll set up | What it does |
| --- | --- |
| A Firebase project | Holds the authentication and database settings. Use a dedicated project for CuePoint so the database rules don’t affect another app. |
| A Firebase Authentication user | Gives you the email and password you’ll enter in CuePoint on every device. |
| A Realtime Database | Stores your cloud bookmarks and notes. Use **Realtime Database**, not **Cloud Firestore**. |
| A registered Firebase web app | Provides the configuration snippet CuePoint needs. You don’t need to build or host a website. |

**Before you start:** Install CuePoint in Firefox and have a Google account that can create a Firebase project. You can use the free **Spark** plan within its usage limits. CuePoint does not require a billing upgrade, Firebase Hosting, Google Analytics, the Firebase CLI, or a service account. Console labels sometimes move; use the console search for **Authentication** or **Realtime Database** if you don’t see them in the sidebar.

## 1. Create a dedicated Firebase project

1. Open the [Firebase Console](https://console.firebase.google.com/) and sign in with your Google account.
2. Select **Create a project** or **Add project**.
3. Enter a name such as `cuepoint-personal`. The console assigns a unique **Project ID**. The name you see in the dashboard and the project ID can be different. You don’t need to choose a specific ID for CuePoint.
4. If offered Google Analytics or other optional services, skip them unless you want them for your project. CuePoint does not use them.
5. Select **Create project**, then open the project once setup finishes. Check that you are on the **Spark** plan if you want to avoid paid billing.

Keep this project selected for all the following steps. The web API key, database URL, and email/password user must all come from this **same project**.

## 2. Enable Email/Password and create your sync user

1. In the project sidebar, open **Authentication**. If this is your first visit, select **Get started**.
2. Open **Sign-in method**. Under the available providers, select **Email/Password**.
3. Enable the **Email/Password** switch and select **Save**. The separate **Email link (passwordless sign-in)** option is not needed; CuePoint uses a password.
4. Open the **Users** tab and select **Add user**.
5. Enter an email address you control and choose a strong, unique password for this Firebase user. Save it in your password manager. The email can be the same address you use for Google, but **do not reuse your Google account password**.
6. Select **Add user** and confirm that the new user appears in the list. Firebase creates a **UID** for the user automatically. You do not have to enter that UID in CuePoint.

You use your **Google account** to administer the Firebase project. You use the **Firebase Authentication user** you just created to sign in to CuePoint. Use the **same Firebase user on every device** that should see the same library. A second Firebase user has a different UID and gets a separate library, even in the same project.

## 3. Create a Realtime Database in Locked mode

1. Open **Realtime Database** in the selected project. Do not select **Firestore Database**.
2. Click **Create Database**.
3. Choose a location. If multiple regions are available, pick one near where you will usually sync. Keep using the same database instance on all devices.
4. Choose **Start in locked mode** and finish creating the database. It is normal for the database to be empty and for clients to be denied access until you publish the rules in the next step.
5. On **Realtime Database → Data**, copy the HTTPS database URL displayed above the data tree. Typical examples are:

   ```text
   https://example-cuepoint-default-rtdb.firebaseio.com
   https://example-cuepoint-default-rtdb.europe-west1.firebasedatabase.app
   ```

   Copy **your own** URL as shown, including its regional suffix if it has one. This is the database’s root URL, not the Firebase Console address, a `.firebaseapp.com` address, or a URL with `/users`, `.json`, or a query string appended.

## 4. Publish CuePoint’s database security rules

**Use these rules as written in a dedicated CuePoint Realtime Database.** If the selected database already serves another app, don’t replace its rules with this snippet. Create a dedicated project instead. Don’t use Test mode or public read/write rules to fix a connection error.

1. Go to **Realtime Database → Rules**. If your project has more than one database, check that this is the instance whose URL you copied.
2. Replace the default Locked-mode rules with the following JSON. The same rules are available under **How to set up Firebase & Security Rules** in CuePoint.

   ```json
   {
     "rules": {
       "users": {
         "$uid": {
           ".read": "auth != null && auth.uid == $uid",
           ".write": "auth != null && auth.uid == $uid",
           "cuepointV2": {
             "videos": {
               "$videoId": {
                 ".validate": "newData.child('videoId').val() == $videoId && newData.child('revision').isNumber() && newData.child('revision').val() >= 0"
               }
             }
           }
         }
       }
     }
   }
   ```

3. Select **Publish**. Editing the text without publishing it does not change access. If the console flags a syntax error, re-copy just the JSON, without the Markdown backticks.

The `auth.uid == $uid` check lets a signed-in Firebase user access only their own `/users/<uid>` subtree through the client API. CuePoint writes videos under `/users/<uid>/cuepointV2/videos`. You don’t need to create any folders or records manually. As the project owner, you can still manage database data in the Firebase Console.

## 5. Register a web app and copy its Firebase configuration

1. Return to **Project overview** and select the **Web (`</>`)** icon. Alternatively, open the gear menu → **Project settings → General → Your apps → Add app** and select **Web**.
2. Enter a nickname such as `CuePoint Firefox` and select **Register app**. Leave the **Firebase Hosting** setup option off; it is not needed.
3. In **SDK setup and configuration**, find the `const firebaseConfig = { ... };` block. If you’ve already registered the web app, open **Project settings → General → Your apps**, select that web app, and look for the configuration snippet. The console may offer **Config**, **npm**, and **Script tag** views.
4. Copy the configuration block. CuePoint needs the **Web API key** (`apiKey`) and the **Realtime Database URL** (`databaseURL`). The rest of the normal Firebase web config can stay in the snippet. An example of the minimum accepted shape is below. These are placeholders; copy the real values from your console.

   ```js
   const firebaseConfig = {
     apiKey: "REPLACE_WITH_YOUR_FIREBASE_WEB_API_KEY",
     databaseURL: "https://example-cuepoint-default-rtdb.firebaseio.com",
   };
   ```

5. If your Firebase snippet does not list `databaseURL`, that’s fine. Paste the snippet into CuePoint first, then enter the separate URL you copied in step 3 when the **Realtime Database URL** field appears.

The web API key identifies your Firebase project. It is not your Firebase user’s password and it does not grant access to the database by itself. Don’t generate a service-account JSON key or paste a private key, database secret, password, or session token into the configuration box.

## 6. Connect CuePoint on your first device

1. Open **CuePoint** from Firefox’s toolbar or **Extensions** menu. This opens the **Moments** page.
2. Open the **Local** storage button at the top of the page and select **Cloud (BYOC)** in **Storage & Live Sync**.
3. Paste the Firebase snippet into **Paste Firebase config snippet (npm or script tag)**. If the **Realtime Database URL** field appears, paste your full database root URL into it. Check that CuePoint detects the right database host.
4. In **Email** and **Password**, enter the Firebase Authentication user from step 2. Do not enter your Google account password.
5. Click **Sign In & Connect**. Review Firefox’s optional data and network permission prompt. If you deny permission, CuePoint stays available in Local mode without cloud sync.
6. After connecting, verify that the **Account** and **Database** shown in the cloud panel match what you intended to use. Seeing an empty cloud library on a new account is normal. You can use **Sync Now** to retry or check the connection.

**Signing in does not upload your existing local library.** Local and cloud libraries are separate. To copy local bookmarks, confirm you are connected to the intended database and account, then choose **Copy Local Moments** and approve the confirmation. This copies rather than moves your bookmarks. Duplicates and bookmarks beyond CuePoint’s per-video limit can be skipped. If you have important local notes, consider exporting a JSON backup first.

## 7. Connect another device and verify sync

1. Install CuePoint in Firefox on the second device and open **Cloud (BYOC)**.
2. Reuse the **same Firebase config**, the **same Realtime Database URL**, and the **same Firebase user’s email and password**. Review the permission prompt on that device too.
3. On the first device, while Cloud is selected, open a regular YouTube watch page in Firefox. Choose **Save moment**, add a short test note such as `Sync check`, and click **Save**. Use a video with an available bookmark slot.
4. Open CuePoint on the second device. Confirm the saved timestamp and note appear. If it takes longer than expected, use **Sync Now** and check each device’s **Account**, **Database**, and sync status.
5. Edit the test note on the second device and verify the change on the first. Delete the test bookmark when you’re done if you don’t want to keep it.

Cloud saves can appear immediately on the device that created them and still be **pending** upload. Keep Firefox open and connected on both devices for the first check. If CuePoint reports a conflict, review the conflict before discarding it; for example, two devices might have saved different moments into a video’s last available slot.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| **Could not find `apiKey` or `databaseURL`** | Copy the web configuration snippet, not the sample SDK installation command or the console URL. If the key is recognised but the database URL is missing, use the separate URL field. |
| **Invalid email or password**, **No account found**, or **Email/Password sign-in is not enabled** | Enable the password provider (not just email-link sign-in). Check **Authentication → Users** for the exact email and confirm the web API key is from that project. If you need a new password, manage the existing user in Firebase, then sign back in on your devices. Don’t delete and recreate the user as a password-reset shortcut; it would get a new UID. |
| **Firebase request failed (HTTP 401/403)** or **Permission denied** | Check that the rules were **published** on the right Realtime Database, the database URL and Firebase user belong to the same project, and Firefox still grants CuePoint’s permissions. If the session has expired, sign out and sign in again. Don’t make the rules public to work around an error. |
| **Firefox data and network permissions are required** | Return to **Cloud (BYOC)** and follow the permission prompt. If you revoked the permissions previously, you need to re-enable Cloud explicitly. Local mode does not need these cloud permissions. |
| **The two devices show different bookmarks** | Confirm both are in **Cloud (BYOC)**, on the same database URL, and using the same Firebase user. A bookmark saved while in **Local** doesn’t appear in Cloud unless you copy or import it. |
| **Pending changes don’t upload** | Check your network connection and whether Firefox still allows cloud permissions. Open the cloud panel and check **Sync Now** or the error text. If the project uses custom API-key restrictions or enforced App Check, try a dedicated project configured as described above rather than weakening protections on another app’s database. |
| **The database is empty in the console** | Connect and save a new test bookmark in Cloud mode, then refresh **Realtime Database → Data** on the correct database. The `users` tree is created on the first write. A Local save won’t create it. |
| **A copied bookmark is missing** | Check the copy result and the **Sync conflicts** section. CuePoint skips duplicate timestamps and limits each video to three saved moments. The original local library is still available in **Local**. |

## Pause sync, sign out, or remove data

- **Pause on a device:** Switch to **Local**. That device stops syncing and shows its separate local library. Switch back to **Cloud (BYOC)** to resume.
- **Sign out:** Choose **Sign Out** in the cloud panel. This removes the saved sign-in session from that profile. It does not erase Firebase data, local bookmarks, or cached cloud bookmarks.
- **Revoke permissions:** In Firefox’s Add-ons Manager, open CuePoint’s permissions and remove the optional cloud permissions. CuePoint stops syncing and needs explicit approval before resuming.
- **Remove cloud data:** Delete the relevant bookmarks in CuePoint while connected, or manage the account’s data in **Realtime Database → Data**. Removing a Firebase Authentication user and deleting their database records are separate actions. If you intend to erase the entire cloud library, export a backup if needed, stop sync on all devices first, and remember that cached data and pending changes on a device are not erased by deleting Firebase records.

For details about what is transmitted and retained, see the [CuePoint privacy policy](src/moments/privacy.html). If you ask for help, share the error text and the step you were on, not your password, session tokens, database contents, or private notes.

### Official Firebase references

- [Create a project and register a web app](https://firebase.google.com/docs/web/setup)
- [Enable Email/Password authentication](https://firebase.google.com/docs/auth/web/password-auth)
- [Set up a Realtime Database](https://firebase.google.com/docs/database/web/start)
- [Understand Realtime Database security rules](https://firebase.google.com/docs/database/security)
- [Firebase pricing plans and usage limits](https://firebase.google.com/pricing)
