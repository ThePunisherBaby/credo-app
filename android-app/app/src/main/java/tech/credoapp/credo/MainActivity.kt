package tech.credoapp.credo

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
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
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var offlineBox: LinearLayout
    private lateinit var updateEngine: GitHubUpdateEngine
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val filePickerLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
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
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        updateEngine = GitHubUpdateEngine(this)

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                useWideViewPort = true
                loadWithOverviewMode = true
                userAgentString = "$userAgentString CredoAndroid/${BuildConfig.VERSION_NAME}"
            }

            addJavascriptInterface(CredoJsBridge(), "CredoNative")

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    val host = uri.host?.lowercase() ?: ""
                    if (host == "credoapp.tech" || host == "www.credoapp.tech") {
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
                setTextColor(Color.parseColor("#DDBB62"))
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

        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(offlineBox, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        setContentView(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
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
        webView.destroy()
        super.onDestroy()
    }
}
