(function () {
  "use strict";

  const RTDB_RULES = JSON.stringify(
    {
      rules: {
        users: {
          $uid: {
            ".read": "auth != null && auth.uid == $uid",
            ".write": "auth != null && auth.uid == $uid",
            cuepointV2: {
              videos: {
                $videoId: {
                  ".validate": "newData.child('videoId').val() == $videoId && newData.child('revision').isNumber() && newData.child('revision').val() >= 0",
                },
              },
            },
          },
        },
      },
    },
    null,
    2,
  );

  const codeEl = document.getElementById("rulesCode");
  const copyBtn = document.getElementById("copyRulesBtn");

  if (codeEl) codeEl.textContent = RTDB_RULES;

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(RTDB_RULES);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy Rules";
        }, 1500);
      } catch {
        window.prompt("Copy Firebase RTDB Security Rules:", RTDB_RULES);
      }
    });
  }
})();
