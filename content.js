(() => {
  const entryUrl = chrome.runtime.getURL("src/entrypoint.js");
  const script = document.createElement("script");
  script.type = "module";
  script.src = entryUrl;
  script.dataset.ytbmEntry = "true";
  script.onload = () => {
    script.remove();
  };
  script.onerror = (error) => {
    console.error("Failed to load YT Beatmaker entrypoint:", error);
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();
