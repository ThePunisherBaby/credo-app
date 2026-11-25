package tech.credoapp.credo

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : AppCompatActivity() {

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private lateinit var offlineBox: LinearLayout
    private lateinit var updateEngine: GitHubUpdateEngine
    private lateinit var mediaNotifier: CredoMediaNotifier
    private var popupContainer: LinearLayout? = null
    private var popupWebView: WebView? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingMediaJson: String? = null
    private var askedNotifPerm = false

    private var safeTopDp = 0f
    private var safeBottomDp = 0f
    private var safeLeftDp = 0f
    private var safeRightDp = 0f
    private var safeTopPx = 0
    private var safeBottomPx = 0
    private var lastIsDark = true

    private val filePickerLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
        }

    private val notifPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                pendingMediaJson?.let { mediaNotifier.updateFromJson(it) }
            }
            pendingMediaJson = null
        }

    inner class CredoJsBridge {
        @JavascriptInterface
        fun getVersionName(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun getVersionCode(): Int = BuildConfig.VERSION_CODE

        @JavascriptInterface
        fun getGitHubRepo(): String = BuildConfig.GITHUB_REPO

        @JavascriptInterface
        fun checkForUpdates() {
            runOnUiThread {
                updateEngine.checkForUpdate(silent = false)
            }
        }

        @JavascriptInterface
        fun setSystemTheme(isDark: Boolean) {
            runOnUiThread {
                applySystemBarAppearance(isDark)
            }
        }

        @JavascriptInterface
        fun setImmersive(enabled: Boolean) {
            runOnUiThread {
                applyImmersiveMode(enabled)
            }
        }

        @JavascriptInterface
        fun updateMediaNotification(json: String) {
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    if (!askedNotifPerm && !json.contains("\"clear\":true")) {
                        askedNotifPerm = true
                        pendingMediaJson = json
                        notifPermLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    }
                    return@runOnUiThread
                }
                mediaNotifier.updateFromJson(json)
            }
        }
    }

    private fun applySystemBarAppearance(isDark: Boolean) {
        lastIsDark = isDark
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !isDark
        controller.isAppearanceLightNavigationBars = !isDark
        val bgColor = if (isDark) Color.BLACK else Color.WHITE
        window.decorView.setBackgroundColor(bgColor)
        if (::webView.isInitialized) {
            webView.setBackgroundColor(bgColor)
        }
    }

    private fun applyImmersiveMode(enabled: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (enabled) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun pushSafeInsetsToWeb() {
        if (!::webView.isInitialized) return
        val js = """
            (function(){
              var r = document.documentElement.style;
              r.setProperty('--native-safe-top', '${safeTopDp}px');
              r.setProperty('--native-safe-bottom', '${safeBottomDp}px');
              r.setProperty('--native-safe-left', '${safeLeftDp}px');
              r.setProperty('--native-safe-right', '${safeRightDp}px');
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        @Suppress("DEPRECATION")
        run {
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            @Suppress("DEPRECATION")
            run {
                window.isStatusBarContrastEnforced = false
                window.isNavigationBarContrastEnforced = false
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                } else {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            }
        }

        val osDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        lastIsDark = osDark
        updateEngine = GitHubUpdateEngine(this)
        mediaNotifier = CredoMediaNotifier(this) { action ->
            runOnUiThread {
                if (::webView.isInitialized) {
                    webView.evaluateJavascript("window.__CREDO_AUDIO__?.handleNativeMediaAction('$action')", null)
                }
            }
        }

        rootLayout = FrameLayout(this).apply {
            setBackgroundColor(if (osDark) Color.BLACK else Color.parseColor("#F2F4F8"))
        }

        CookieManager.getInstance().setAcceptCookie(true)

        webView = WebView(this).apply {
            setBackgroundColor(if (osDark) Color.BLACK else Color.parseColor("#F2F4F8"))
            overScrollMode = View.OVER_SCROLL_NEVER
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            settings.apply {
                javaScriptEnabled = true
                javaScriptCanOpenWindowsAutomatically = true
                setSupportMultipleWindows(true)
                domStorageEnabled = true
                @Suppress("DEPRECATION")
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
                textZoom = textZoom.coerceIn(90, 115)
                userAgentString = "$userAgentString CredoAndroid/${BuildConfig.VERSION_NAME}"
            }

            addJavascriptInterface(CredoJsBridge(), "CredoNative")

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    val host = uri.host?.lowercase() ?: ""
                    if (isInAppCheckoutHost(host)) {
                        return false
                    }
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: Exception) {}
                    return true
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    offlineBox.visibility = View.GONE
                    webView.visibility = View.VISIBLE
                    pushSafeInsetsToWeb()
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    if (request?.isForMainFrame == true) {
                        webView.visibility = View.GONE
                        offlineBox.visibility = View.VISIBLE
                    }
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onCreateWindow(
                    view: WebView?,
                    isDialog: Boolean,
                    isUserGesture: Boolean,
                    resultMsg: Message?
                ): Boolean {
                    val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
                    openInAppPopupWebView(transport, resultMsg)
                    return true
                }

                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = filePathCallback
                    return try {
                        val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            type = "image/*"
                        }
                        filePickerLauncher.launch(intent)
                        true
                    } catch (_: Exception) {
                        this@MainActivity.filePathCallback = null
                        false
                    }
                }
            }
        }

        offlineBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            setPadding(64, 64, 64, 64)
            visibility = View.GONE

            addView(TextView(context).apply {
                text = "Credo"
                textSize = 28f
                setTextColor(Color.parseColor("#0A84FF"))
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                text = "Sin conexión a internet.\nVerifica tu red e intenta nuevamente."
                textSize = 15f
                setTextColor(Color.parseColor("#B8BCC8"))
                gravity = Gravity.CENTER
                setPadding(0, 24, 0, 40)
            })
            addView(Button(context).apply {
                text = "Reintentar"
                setOnClickListener {
                    offlineBox.visibility = View.GONE
                    webView.visibility = View.VISIBLE
                    webView.loadUrl(BuildConfig.CREDO_URL)
                }
            })
        }

        rootLayout.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        rootLayout.addView(offlineBox, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        // True edge-to-edge full screen: ZERO system-bar padding on root.
        // Elevate bottom inset slightly above system gesture handle / 3-button navigation bar so dock feels effortlessly tappable.
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { view, insets ->
            val safe = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val tappable = insets.getInsets(WindowInsetsCompat.Type.tappableElement())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val density = resources.displayMetrics.density.coerceAtLeast(1f)
            safeTopPx = safe.top
            safeBottomPx = bars.bottom
            safeTopDp = ((safe.top / density) - 4f).coerceAtLeast(0f)
            val tapBotDp = tappable.bottom / density
            val sysBotDp = bars.bottom / density
            safeBottomDp = if (tapBotDp >= 28f) (tapBotDp + 6f) else sysBotDp.coerceIn(14f, 24f)
            safeLeftDp = bars.left / density
            safeRightDp = bars.right / density

            view.setPadding(0, 0, 0, ime.bottom)
            pushSafeInsetsToWeb()
            WindowInsetsCompat.CONSUMED
        }

        setContentView(rootLayout)
        applySystemBarAppearance(osDark)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val pv = popupWebView
                if (pv != null) {
                    if (pv.canGoBack()) {
                        pv.goBack()
                    } else {
                        closeInAppPopupWebView()
                    }
                    return
                }
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        val prefs = getSharedPreferences("credo_app_prefs", MODE_PRIVATE)
        val lastVerCode = prefs.getInt("last_ver_code", 0)
        if (lastVerCode != BuildConfig.VERSION_CODE) {
            webView.clearCache(true)
            prefs.edit().putInt("last_ver_code", BuildConfig.VERSION_CODE).apply()
        }

        val startUrl = intent?.dataString?.takeIf { it.startsWith("https://credoapp.tech") }
            ?: BuildConfig.CREDO_URL
        webView.loadUrl(startUrl)

        // Check GitHub Releases automatically on launch (silent autonomous background download)
        updateEngine.checkForUpdate(silent = true)
    }

    private fun isInAppCheckoutHost(host: String): Boolean {
        if (host.isEmpty()) return true
        return host == "credoapp.tech" ||
            host == "www.credoapp.tech" ||
            host == "paypal.com" ||
            host.endsWith(".paypal.com") ||
            host == "paypalobjects.com" ||
            host.endsWith(".paypalobjects.com") ||
            host.endsWith(".braintree-api.com") ||
            host.endsWith(".cardinalcommerce.com") ||
            host == "venmo.com" ||
            host.endsWith(".venmo.com")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openInAppPopupWebView(transport: WebView.WebViewTransport, resultMsg: Message) {
        closeInAppPopupWebView()

        val density = resources.displayMetrics.density.coerceAtLeast(1f)
        val padH = (14 * density).toInt()
        val padV = (10 * density).toInt()

        val titleView = TextView(this).apply {
            text = "🔒 Pago seguro · PayPal"
            textSize = 14f
            setTextColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val closeBtn = Button(this).apply {
            text = "Cerrar"
            textSize = 13f
            setTextColor(Color.parseColor("#38BDF8"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { closeInAppPopupWebView() }
        }

        val headerBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0F1115"))
            setPadding(padH, safeTopPx + padV, padH, padV)
            addView(titleView)
            addView(closeBtn)
        }

        val child = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            settings.apply {
                javaScriptEnabled = true
                javaScriptCanOpenWindowsAutomatically = true
                setSupportMultipleWindows(true)
                domStorageEnabled = true
                @Suppress("DEPRECATION")
                databaseEnabled = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                useWideViewPort = true
                loadWithOverviewMode = true
                // Clean Chrome mobile UA (strip "; wv") so PayPal checkout & 3DS never block Android WebView
                userAgentString = userAgentString.replace("; wv)", ")")
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    val host = uri.host?.lowercase() ?: ""
                    if (host == "credoapp.tech" || host == "www.credoapp.tech") {
                        val urlStr = uri.toString()
                        if (urlStr.contains("paypal_return=1") || urlStr.contains("paypal_sub_return=1") || urlStr.contains("paypal_cancel=1")) {
                            closeInAppPopupWebView()
                            webView.loadUrl(urlStr)
                            return true
                        }
                    }
                    return false
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    val h = try { Uri.parse(url).host } catch (_: Exception) { null }
                    if (!h.isNullOrBlank()) {
                        titleView.text = "🔒 $h"
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onCloseWindow(window: WebView?) {
                    closeInAppPopupWebView()
                }
            }
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0F1115"))
            setPadding(0, 0, 0, safeBottomPx)
            addView(headerBar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(child, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }

        popupWebView = child
        popupContainer = container
        rootLayout.addView(
            container,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        )

        transport.webView = child
        resultMsg.sendToTarget()
    }

    private fun closeInAppPopupWebView() {
        popupWebView?.let { pv ->
            try {
                pv.stopLoading()
                pv.destroy()
            } catch (_: Exception) {}
        }
        popupWebView = null
        popupContainer?.let { pc ->
            try {
                rootLayout.removeView(pc)
            } catch (_: Exception) {}
        }
        popupContainer = null
    }

    private var lastAutoUpdateCheckMs = System.currentTimeMillis()

    override fun onResume() {
        super.onResume()
        updateEngine.resumePendingInstallIfPermitted()
        val now = System.currentTimeMillis()
        if (now - lastAutoUpdateCheckMs > 15 * 60 * 1000L) {
            lastAutoUpdateCheckMs = now
            updateEngine.checkForUpdate(silent = true)
        }
    }

    override fun onDestroy() {
        closeInAppPopupWebView()
        if (::mediaNotifier.isInitialized) mediaNotifier.release()
        webView.destroy()
        super.onDestroy()
    }
}
