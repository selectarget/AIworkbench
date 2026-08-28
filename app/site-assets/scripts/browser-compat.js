function installBrowserCompatPatch() {
  try {
    const code = `
      (function () {
        try {
          var fingerprintApplied = Boolean(window.__AIAM_FINGERPRINT_APPLIED);
          var userAgentText = String(navigator.userAgent || "");
          var platformText = String(navigator.platform || "");
          var isMac = /Macintosh|Mac OS X/i.test(userAgentText) || /Mac/i.test(platformText);
          var browserPlatform = isMac ? "MacIntel" : "Win32";
          var dataPlatform = isMac ? "macOS" : "Windows";
          var dataArchitecture = isMac && /arm|aarch64/i.test(userAgentText) ? "arm" : "x86";
          var chromeVersion = (navigator.userAgent.match(/Chrome\\/([0-9.]+)/) || [])[1] || "142.0.7444.175";
          var chromeMajor = String(chromeVersion).split(".")[0] || "142";
          var defineGetter = function (target, name, value) {
            try {
              Object.defineProperty(target, name, {
                get: function () { return value; },
                configurable: true
              });
            } catch (e) {}
          };
          defineGetter(navigator, "webdriver", false);
          if (!fingerprintApplied) {
            defineGetter(navigator, "languages", ["zh-CN", "zh", "en"]);
            defineGetter(navigator, "language", "zh-CN");
            defineGetter(navigator, "platform", browserPlatform);
            defineGetter(navigator, "vendor", "Google Inc.");
            defineGetter(navigator, "maxTouchPoints", 0);
          }
          if (!window.chrome) window.chrome = {};
          window.chrome.app = window.chrome.app || { isInstalled: false };
          window.chrome.csi = window.chrome.csi || function () { return {}; };
          window.chrome.loadTimes = window.chrome.loadTimes || function () { return {}; };
          window.chrome.runtime = window.chrome.runtime || {};
          window.chrome.runtime.PlatformOs = window.chrome.runtime.PlatformOs || { MAC: "mac", WIN: "win", ANDROID: "android", CROS: "cros", LINUX: "linux", OPENBSD: "openbsd", FUCHSIA: "fuchsia" };
          window.chrome.runtime.PlatformArch = window.chrome.runtime.PlatformArch || { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64", MIPS: "mips", MIPS64: "mips64" };
          window.chrome.runtime.connect = window.chrome.runtime.connect || function () { return { onDisconnect: { addListener: function () {} }, onMessage: { addListener: function () {} }, postMessage: function () {} }; };
          window.chrome.runtime.sendMessage = window.chrome.runtime.sendMessage || function () {};
          if (!window.chrome.csi || !window.chrome.csi.__aiamCompat) {
            var csi = function () { return { startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 }; };
            csi.__aiamCompat = true;
            window.chrome.csi = csi;
          }
          if (!window.chrome.loadTimes || !window.chrome.loadTimes.__aiamCompat) {
            var loadTimes = function () { return { commitLoadTime: Date.now() / 1000, connectionInfo: "h2", finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintAfterLoadTime: 0, firstPaintTime: 0, navigationType: "Other", requestTime: 0, wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: "h2" }; };
            loadTimes.__aiamCompat = true;
            window.chrome.loadTimes = loadTimes;
          }
          try {
            if (typeof Plugin !== "undefined" && typeof PluginArray !== "undefined" && typeof MimeType !== "undefined" && typeof MimeTypeArray !== "undefined" && (!navigator.plugins || navigator.plugins.length === 0)) {
              var pdfPlugin = Object.create(Plugin.prototype);
              var pdfChromeMime = Object.create(MimeType.prototype);
              var pdfMime = Object.create(MimeType.prototype);
              Object.defineProperties(pdfChromeMime, { type: { value: "application/x-google-chrome-pdf", configurable: true }, suffixes: { value: "pdf", configurable: true }, description: { value: "Portable Document Format", configurable: true }, enabledPlugin: { value: pdfPlugin, configurable: true } });
              Object.defineProperties(pdfMime, { type: { value: "application/pdf", configurable: true }, suffixes: { value: "pdf", configurable: true }, description: { value: "", configurable: true }, enabledPlugin: { value: pdfPlugin, configurable: true } });
              Object.defineProperties(pdfPlugin, { name: { value: "Chrome PDF Plugin", configurable: true }, description: { value: "Portable Document Format", configurable: true }, filename: { value: "internal-pdf-viewer", configurable: true }, length: { value: 2, configurable: true }, 0: { value: pdfChromeMime, configurable: true }, 1: { value: pdfMime, configurable: true }, item: { value: function (index) { return this[index] || null; }, configurable: true }, namedItem: { value: function (name) { return name === "application/pdf" ? this[1] : name === "application/x-google-chrome-pdf" ? this[0] : null; }, configurable: true } });
              var plugins = Object.create(PluginArray.prototype);
              Object.defineProperties(plugins, { length: { value: 1, configurable: true }, 0: { value: pdfPlugin, configurable: true }, item: { value: function (index) { return this[index] || null; }, configurable: true }, namedItem: { value: function (name) { return name === pdfPlugin.name ? pdfPlugin : null; }, configurable: true } });
              var mimeTypes = Object.create(MimeTypeArray.prototype);
              Object.defineProperties(mimeTypes, { length: { value: 2, configurable: true }, 0: { value: pdfChromeMime, configurable: true }, 1: { value: pdfMime, configurable: true }, item: { value: function (index) { return this[index] || null; }, configurable: true }, namedItem: { value: function (name) { return name === pdfChromeMime.type ? pdfChromeMime : name === pdfMime.type ? pdfMime : null; }, configurable: true } });
              defineGetter(navigator, "plugins", plugins);
              defineGetter(navigator, "mimeTypes", mimeTypes);
            }
          } catch (e) {}
          try {
            if (typeof window.outerWidth === "number" && window.outerWidth <= window.innerWidth) defineGetter(window, "outerWidth", window.innerWidth + 8);
            if (typeof window.outerHeight === "number" && window.outerHeight <= window.innerHeight) defineGetter(window, "outerHeight", window.innerHeight + 37);
          } catch (e) {}
          try {
            if (!navigator.connection) defineGetter(navigator, "connection", { effectiveType: "4g", rtt: 50, downlink: 10, saveData: false, onchange: null, addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return true; } });
          } catch (e) {}
          try {
            if (typeof Permissions !== "undefined" && Permissions.prototype && typeof Permissions.prototype.query === "function" && !Permissions.prototype.query.__aiamCompat) {
              var originalPermissionQuery = Permissions.prototype.query;
              var permissionQuery = function (descriptor) {
                if (descriptor && descriptor.name === "notifications") return Promise.resolve({ state: "default", onchange: null });
                return originalPermissionQuery.call(this, descriptor);
              };
              permissionQuery.__aiamCompat = true;
              Permissions.prototype.query = permissionQuery;
            }
          } catch (e) {}
          try {
            if (typeof Document !== "undefined" && Document.prototype && typeof Document.prototype.hasFocus === "function" && !Document.prototype.hasFocus.__aiamCompat) {
              var originalHasFocus = Document.prototype.hasFocus;
              var hasFocus = function () { return document.visibilityState === "visible" ? true : originalHasFocus.call(this); };
              hasFocus.__aiamCompat = true;
              Document.prototype.hasFocus = hasFocus;
            }
          } catch (e) {}
          try {
            if (typeof Screen !== "undefined" && !fingerprintApplied) {
              defineGetter(Screen.prototype, "colorDepth", 24);
              defineGetter(Screen.prototype, "pixelDepth", 24);
              defineGetter(Screen.prototype, "top", 0);
              defineGetter(Screen.prototype, "left", 0);
              if ("isExtended" in Screen.prototype) defineGetter(Screen.prototype, "isExtended", false);
            }
          } catch (e) {}
          try {
            Object.keys(window).filter(function (key) { return /^cdc_/.test(key); }).forEach(function (key) { try { delete window[key]; } catch (e) {} });
          } catch (e) {}
          if (!fingerprintApplied) try {
            Object.defineProperty(navigator, "userAgentData", {
              get: function () {
                return {
                  brands: [
                    { brand: "Google Chrome", version: chromeMajor },
                    { brand: "Chromium", version: chromeMajor },
                    { brand: "Not_A Brand", version: "99" }
                  ],
                  mobile: false,
                  platform: dataPlatform,
                  getHighEntropyValues: function (hints) {
                    var values = {
                      brands: [
                        { brand: "Google Chrome", version: chromeMajor },
                        { brand: "Chromium", version: chromeMajor },
                        { brand: "Not_A Brand", version: "99" }
                      ],
                      fullVersionList: [
                        { brand: "Google Chrome", version: chromeVersion },
                        { brand: "Chromium", version: chromeVersion },
                        { brand: "Not_A Brand", version: "99.0.0.0" }
                      ],
                      mobile: false,
                      platform: dataPlatform,
                      platformVersion: "15.0.0",
                      architecture: dataArchitecture,
                      bitness: "64",
                      model: "",
                      uaFullVersion: chromeVersion,
                      wow64: false
                    };
                    var out = {};
                    (hints || []).forEach(function (hint) {
                      if (Object.prototype.hasOwnProperty.call(values, hint)) out[hint] = values[hint];
                    });
                    out.brands = values.brands;
                    out.mobile = values.mobile;
                    out.platform = values.platform;
                    return Promise.resolve(out);
                  },
                  toJSON: function () {
                    return { brands: this.brands, mobile: false, platform: dataPlatform };
                  }
                };
              },
              configurable: true
            });
          } catch (e) {}
          window.__AIAM_BROWSER_COMPAT = true;
        } catch (e) {}
      })();
    `;
    const script = document.createElement('script');
    script.textContent = code;
    (document.documentElement || document.head || document).appendChild(script);
    script.remove();
  } catch (e) {}
}

installBrowserCompatPatch();
