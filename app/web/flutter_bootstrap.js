{{flutter_js}}
{{flutter_build_config}}

(function () {
  // Unregister legacy/deprecated service workers so updates always load cleanly
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      for (const r of regs) r.unregister();
    }).catch(function () {});
  }

  function isWebGLHealthy() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl || gl.isContextLost()) return false;
      const ver = gl.getParameter(0x1F02);  // VERSION
      const glsl = gl.getParameter(0x8B8C); // SHADING_LANGUAGE_VERSION
      return (
        typeof ver === 'string' &&
        ver.length > 0 &&
        typeof glsl === 'string' &&
        glsl.length > 0
      );
    } catch (_) {
      return false;
    }
  }

  const webglOk = isWebGLHealthy();
  const engineConfig = {
    canvasKitBaseUrl: '/canvaskit/',
    canvasKitForceCpuOnly: !webglOk,
  };

  _flutter.loader.load({
    config: engineConfig,
    onEntrypointLoaded: async function (engineInitializer) {
      const appRunner = await engineInitializer.initializeEngine(engineConfig);
      await appRunner.runApp();
      const splash = document.getElementById('credo-splash');
      if (splash) {
        splash.style.opacity = '0';
        setTimeout(function () { splash.remove(); }, 250);
      }
    },
  });
})();
