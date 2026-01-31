(() => {
  const entryUrl = chrome.runtime.getURL("src/entrypoint.js");
  import(entryUrl).catch((error) => {
    console.error("Failed to load YT Beatmaker entrypoint:", error);
  });
})();
