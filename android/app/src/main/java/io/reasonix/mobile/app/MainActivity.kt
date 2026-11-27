package io.reasonix.mobile.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL

/**
 * The window: one WebView on the kernel's loopback origin.
 *
 * Almost everything the person does is the page's, and deliberately so — the
 * interface is the same build the desktop Studio serves, which is what keeps one
 * product rather than two. What this class adds is what a page cannot do for
 * itself on a phone:
 *
 *  - the system back gesture means "go back in the page", and only means "leave"
 *    when there is nowhere left to go;
 *  - a download goes to the system's file picker, because a WebView has no
 *    downloads shelf and app-private storage is not where a person looks;
 *  - a link to somewhere else opens in the real browser, where the person's
 *    logins and tabs are;
 *  - the kernel is started before the page is asked for, and kept alive by the
 *    service, because a phone kills a backgrounded child process in seconds.
 *
 * The kernel runs on this device, so the app is complete on its own: nothing
 * here pairs with a computer or reaches one.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var splash: View
    private lateinit var bridge: NativeBridge
    private lateinit var rootLayout: FrameLayout

    /** set once the first page is up, so a reload does not go through the splash */
    private var booted = false

    /** The download waiting for a place to go, held between the two halves of
     *  the system picker's round trip. */
    private var pendingDownload: PendingDownload? = null

    /**
     * Where the document in the WebView's main frame came from.
     *
     * The bridge answers "may this caller use me?" from this rather than from
     * what the shell asked to load, because a page that navigated itself
     * somewhere else is still the one holding the bridge. `onPageStarted` keeps
     * it current, so a main-frame navigation is what changes the answer.
     */
    private var mainFrameOrigin: String? = null

    /** The window's safe area in pixels, as left, top, right, bottom. */
    private var safeArea = intArrayOf(0, 0, 0, 0)

    private data class PendingDownload(val url: String, val userAgent: String, val mime: String, val name: String)

    private val saveDownload = registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { target ->
        val job = pendingDownload ?: return@registerForActivityResult
        pendingDownload = null
        if (target == null) return@registerForActivityResult
        // The fetch is the WebView's, because the cookie that authorises it is
        // the WebView's: the kernel's download route is behind the same session
        // the page is using, and the shell has no cookie jar of its own.
        lifecycleScope.launch {
            val result = Downloader.run(this@MainActivity, job.url, job.userAgent, job.mime, job.name, target)
            Downloader.report(this@MainActivity, job.name, result)
        }
    }

    /** The bytes waiting for a place to go, held between the two halves of the
     *  save dialog's round trip. */
    private var pendingSave: Pair<String, ByteArray>? = null

    /**
     * Where the page's bytes landed.
     *
     * The page cannot do this itself: a WebView has no downloads shelf, and its
     * `DownloadListener` fires only for a real navigation — not for a blob the
     * page just built. So the bytes come across the bridge and are written here,
     * to the place the system's picker answered with.
     *
     * A null target is a dismissal, and the bridge reads it as "" the same way
     * it reads a dismissed folder picker.
     */
    private val saveBytesFile = registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { target ->
        val job = pendingSave
        pendingSave = null
        if (target != null && job != null) {
            val written = runCatching {
                contentResolver.openOutputStream(target, "wt")?.use { out ->
                    out.write(job.second)
                } ?: throw java.io.FileNotFoundException(target.toString())
            }
            if (written.isFailure) {
                Toast.makeText(
                    this,
                    getString(R.string.download_failed, written.exceptionOrNull()?.message.orEmpty()),
                    Toast.LENGTH_LONG,
                ).show()
            }
        }
        bridge.deliverSave(target)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        // The devtools channel is how a debug build is inspected from a desk:
        // `scripts/verify-keyboard.mjs` drives the very same WebView through it.
        // A release keeps it off — the page holds a session credential.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        rootLayout = FrameLayout(this)
        web = WebView(this)
        rootLayout.addView(
            web,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        splash = layoutInflater.inflate(R.layout.view_splash, rootLayout, false)
        rootLayout.addView(
            splash,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        setContentView(rootLayout)
        syncWindowTheme("light")

        configureWebView()
        // Keep the renderer alive while the app is off screen.
        //
        // A WebView's default policy is `RENDERER_PRIORITY_BOUND` with
        // `waivedWhenNotVisible` true, which tells Android the renderer may be
        // reclaimed the moment the window is not in front. On this app that is
        // the wrong answer twice over: the page is the only place the running
        // turn is shown, and rebuilding it means re-subscribing the event stream
        // from scratch — so a phone pocketed mid-answer came back to a
        // transcript that had stopped growing. `IMPORTANT` with waiving off says
        // the renderer is doing work the person asked for, which is what the
        // foreground service says about the kernel beside it.
        //
        // The cost is real and bounded: one renderer's memory, held while the app
        // is backgrounded. It is the same renderer the foreground service already
        // keeps the kernel for.
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        installBridge(web)
        // The insets have to be read from the window and pushed into the page:
        // `env(safe-area-inset-*)` is an iOS Safari feature and a WebView answers
        // it with 0, so without this the interface starts under the status bar.
        installInsetsListener()
        ViewCompat.requestApplyInsets(rootLayout)

        // The kernel runs under the service, so it survives the screen going off
        // and a task that takes minutes finishes. Starting it here as well is
        // what makes the app usable in one tap: the service is the guarantee,
        // this is the path.
        KernelService.start(this)

        lifecycleScope.launch {
            (application as App).kernel.start()
                .onSuccess { load(it) }
                .onFailure { showFailure(it) }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // The page answers first: its settings, menus and previews are
                // state, not history. Only an unhandled press leaves the window,
                // and to the background, so the kernel outlives the screen.
                askPageForBack()
            }
        })
    }

    /** The page takes back when it has a layer open; otherwise the shell leaves. */
    private fun askPageForBack() {
        if (isFinishing || isDestroyed) return
        val script = "(function(){try{return (window.__reasonixBack && window.__reasonixBack()) ? 1 : 0;}" +
            "catch(e){return 0;}})()"
        val asked = runCatching {
            web.evaluateJavascript(script) { result ->
                if (result?.trim() != "1") leaveOrGoBack()
            }
        }.isSuccess
        if (!asked) leaveOrGoBack()
    }

    private fun leaveOrGoBack() {
        if (runCatching { web.canGoBack() }.getOrDefault(false)) {
            web.goBack()
        } else {
            moveTaskToBack(true)
        }
    }

    private fun configureWebView() = with(web.settings) {
        javaScriptEnabled = true
        // localStorage holds the theme, the language and the session filter —
        // all of it the page's own state, none of it a credential.
        domStorageEnabled = true
        databaseEnabled = true
        // The page is served over HTTP from loopback; file access would add a
        // second, weaker origin for no gain, so it stays off.
        allowFileAccess = false
        allowContentAccess = false
        allowFileAccessFromFileURLs = false
        allowUniversalAccessFromFileURLs = false
        setSupportZoom(false)
        builtInZoomControls = false
        displayZoomControls = false
        // The page is responsive and sets its own viewport; a WebView that also
        // fits content to the screen fights it and produces a layout neither
        // intends.
        useWideViewPort = true
        loadWithOverviewMode = false
        mediaPlaybackRequiresUserGesture = false
        cacheMode = WebSettings.LOAD_DEFAULT
        // Cookies carry the session the page traded its fragment for. Without
        // them a reload loses the credential and the kernel refuses the page.
        CookieManager.getInstance().setAcceptCookie(true)
        // Not third-party: the page carries a first-party credential and nothing
        // it loads is cross-origin, so accepting them would only widen what a
        // later change could reach.
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
    }

    /**
     * The file input a page is waiting on.
     *
     * A WebView does not open a picker by itself. The page's input fires
     * `onShowFileChooser` on the chrome client, and a client that does not
     * override it answers "nothing happened" — which is exactly how the
     * composer's attachment button read: a tap that produced no picker and no
     * error. The callback is held because every source is another activity, so
     * the answer arrives after this call returns.
     */
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    /** The camera permission, asked for when the menu's capture entry is chosen. */
    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) {
            Toast.makeText(this, getString(R.string.attach_no_camera), Toast.LENGTH_LONG).show()
        }
        // Granted: the question the person asked has been answered, and the
        // attachment menu is one tap away again. Re-opening the camera from here
        // would be a dialog they did not ask for in a moment they did not choose.
    }

    /**
     * Whether the camera may be used now.
     *
     * Asked through the activity rather than checked in place: a first run has
     * no grant, and a menu entry that silently cancels is indistinguishable
     * from a broken camera. This answers false and starts the request.
     */
    private fun ensureCameraPermission(): Boolean {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return true
        }
        askCamera.launch(Manifest.permission.CAMERA)
        return false
    }

    private val nativeResults = mutableMapOf<String, String>()
    private val folders = FolderPicker(this) { path -> finishNativePicker("pickFolder", path) }

    /**
     * The attachment menu, created with the activity.
     *
     * It has to be: `registerForActivityResult` attaches its launchers to the
     * activity's result registry, and that registry is closed once the activity
     * reaches STARTED. An instance built inside `onShowFileChooser` — which is
     * exactly when a page asks for a file — throws
     * `IllegalStateException: LifecycleOwner is attempting to register while
     * current state is RESUMED`, which is the crash the menu caused.
     */
    private val picker = AttachmentPicker(
        this,
        onChosen = { uris -> deliverChosen(uris) },
        onCancelled = { deliverChosen(emptyList()) },
        ensureCamera = { ensureCameraPermission() },
    )

    private fun finishNativePicker(method: String, value: String?) {
        nativeResults.remove(method)?.let { replyHost(it, JSONObject.quote(value.orEmpty())) }
    }

    /**
     * Give the page its way into the phone.
     *
     * The bridge object is created per window, holds nothing across a
     * configuration change that the page cannot re-ask for, and is reachable
     * under exactly one name — the one the injected interface looks for.
     */
    @SuppressLint("AddJavascriptInterface")
    private fun installBridge(target: WebView) {
        bridge = NativeBridge { url ->
            runOnUiThread { openExternally(Uri.parse(url)) }
        }
        // The bridge is reachable from any document the WebView loads, so it asks
        // before acting. Only the kernel's own page is answered yes: this app has
        // no second origin to trust, and `mainFrameOrigin` is what the main frame
        // actually is right now rather than what was last asked for.
        bridge.trusted = {
            val origin = mainFrameOrigin
            origin != null && origin == (application as App).kernel.origin
        }
        bridge.askForSave = { name, bytes ->
            pendingSave = name to bytes
            runCatching { saveBytesFile.launch(name) }
                .onSuccess { }
                .onFailure { pendingSave = null }
                .isSuccess
        }
        bridge.onHostCall = { id, method, args -> handleHostCall(id, method, args) }
        target.addJavascriptInterface(bridge, "ReasonixNative")
    }

    private fun installInsetsListener() {
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { _, insets ->
            val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            // The centered punch-hole sits on the short edge; in landscape that
            // edge is a side and the page does not avoid it. Only system bars
            // (the status bar on the long edge, the navigation bar) are padded.
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            // The bars stay the page's to avoid, so it can paint under them. The
            // keyboard is the window's: edge to edge stops `adjustResize` from
            // shrinking the window, so the room it needs is taken here.
            safeArea = intArrayOf(bars.left, bars.top, bars.right, if (keyboard > 0) 0 else bars.bottom)
            rootLayout.setPadding(bars.left, 0, bars.right, keyboard)
            splash.setPadding(bars.left, bars.top, bars.right, maxOf(keyboard, bars.bottom))
            publishSafeArea()
            // Zeroing rather than CONSUMED: the page has taken these areas, and
            // consuming would block the WebView's own later updates.
            WindowInsetsCompat.Builder(insets).setInsets(types, Insets.NONE).build()
        }
    }

    /** Hand the window's safe area to the page, in CSS pixels.
     *
     *  A WebView only forwards `env(safe-area-inset-*)` when it overlaps the
     *  bars itself, and older builds forward nothing at all. Publishing the
     *  numbers this window measured is what makes the page's own padding right
     *  on every WebView the APK can meet. */
    private fun publishSafeArea() {
        if (!::web.isInitialized) return
        val density = resources.displayMetrics.density
        val dp = safeArea.map { (it / density).toInt() }
        // Left and right are already in the WebView's padding; publishing them
        // again would double-inset the surfaces that add the safe vars.
        web.evaluateJavascript(
            """
(function() {
  var s = document.documentElement.style;
  s.setProperty('--rx-safe-top', '${dp[1]}px');
  s.setProperty('--rx-safe-right', '0px');
  s.setProperty('--rx-safe-bottom', '${dp[3]}px');
  s.setProperty('--rx-safe-left', '0px');
})();
            """.trimIndent(),
            null,
        )
    }

    private fun syncWindowTheme(scheme: String) {
        val light = scheme != "dark"
        WindowCompat.getInsetsController(window, web).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
        rootLayout.setBackgroundColor(getColor(if (light) R.color.page else R.color.page_dark))
    }

    private fun installClients() {
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                // The kernel's own page is this app's, and staying inside it is
                // what keeps the page's own links working. Exact origins, not a
                // string prefix: `http://127.0.0.1:50001/` starts with
                // `http://127.0.0.1:5000` and would be read as the kernel's own
                // page, which is how a host on a nearby port gets treated as this
                // app's. `originOf` keeps the port, so the two are compared as
                // the origins they are.
                val kernelOrigin = (application as App).kernel.origin
                if (kernelOrigin != null && originOf(url) == kernelOrigin) return false
                // Anything else belongs in the real browser: a documentation
                // link, a provider's console, a sign-in page. Loading one inside
                // this WebView would strand the person in a window with no
                // address bar.
                if (url.scheme == "http" || url.scheme == "https") {
                    openExternally(url)
                    return true
                }
                // A non-web scheme (mailto:, tel:, an app link) is the system's
                // to route — but only the two whose meaning cannot make Android
                // start an arbitrary exported activity with caller-supplied
                // extras. An `intent://` URL is exactly that, and a page can
                // navigate to one, so it is dropped rather than routed.
                if (url.scheme != "mailto" && url.scheme != "tel") return true
                return runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)); true }
                    .getOrDefault(false)
            }

            // Main-frame navigation is what decides who holds the bridge. Read
            // here rather than from `view.url` in the bridge, because the value
            // has to be right for the document being started, not the one being
            // left.
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (!url.startsWith("chrome-error:")) {
                    mainFrameOrigin = originOf(Uri.parse(url))
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                injectHostBridge()
                // The insets listener may have run before any document existed,
                // so the numbers it measured are published again here.
                publishSafeArea()
                if (!booted) {
                    booted = true
                    splash.animate().alpha(0f).setDuration(220).withEndAction {
                        splash.visibility = View.GONE
                    }.start()
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: android.webkit.WebResourceError,
            ) {
                // The main document failing is the kernel being gone, which is
                // worth saying; a subresource failing is noise the page already
                // handles for itself.
                if (request.isForMainFrame && booted) {
                    showFailure(IllegalStateException(getString(R.string.err_kernel_unreachable)))
                }
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: android.webkit.RenderProcessGoneDetail,
            ): Boolean {
                // The renderer is a separate process and Android reclaims it
                // under pressure. The shell's process — and the kernel, which is
                // its child — is still alive, so the window is rebuilt rather
                // than the app being taken down with its renderer. The kernel is
                // asked for its URL again, which returns the running one.
                rebuildWebView()
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                (splash.findViewById<ProgressBar>(R.id.splash_bar))?.progress = newProgress
            }

            /**
             * Hand the page's file input to this shell's attachment menu.
             *
             * The WebView would answer with one system picker, which reaches the
             * document browser and nothing else. A phone composer offers three
             * sources, so the choice is made here and each branch reports through
             * the same callback — `filePathCallback`, which is the page's own
             * request and stays unanswered until a source answers.
             */
            override fun onShowFileChooser(
                view: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                // A previous callback that never got its answer — a tap while
                // the menu was already up — is released, or the WebView keeps a
                // call that will never complete.
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                picker.ask(fileChooserParams)
                return true
            }
        }

        web.setDownloadListener(DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            beginDownload(url, userAgent, contentDisposition, mimeType)
        })
    }

    /** Answer the page's waiting file input, exactly once. */
    private fun deliverChosen(uris: List<Uri>) {
        val callback = fileChooserCallback ?: return
        fileChooserCallback = null
        callback.onReceiveValue(uris.takeIf { it.isNotEmpty() }?.toTypedArray())
    }

    /**
     * A renderer is not restartable, so the only recovery is a new WebView in
     * the same place. The splash comes back for the moment it takes the kernel
     * to answer, which is honest: the page really is being loaded again.
     */
    private fun rebuildWebView() {
        val parent = web.parent as? ViewGroup ?: return
        val index = parent.indexOfChild(web)
        parent.removeView(web)
        web.destroy()

        val fresh = WebView(this)
        web = fresh
        parent.addView(
            fresh,
            index,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        configureWebView()
        // A bridge belongs to one WebView, so a rebuilt renderer needs its own:
        // the old object was reachable only from the destroyed window.
        installBridge(fresh)
        installClients()
        installInsetsListener()
        ViewCompat.requestApplyInsets(rootLayout)

        splash.alpha = 1f
        splash.visibility = View.VISIBLE
        // The cookie is still in the jar, so the plain origin is enough and no
        // credential is re-sent.
        (application as App).kernel.plainUrl()?.let { fresh.loadUrl(it) }
    }

    private fun load(origin: String) {
        installClients()
        val cookie = (application as App).kernel.sessionCookie() ?: return
        CookieManager.getInstance().setCookie(origin, cookie) { accepted ->
            if (accepted) web.loadUrl(origin)
            else showFailure(IllegalStateException("无法建立应用内核的本地会话"))
        }
    }

    /** `scheme://host:port`, the part a cookie is scoped to, or null if the URL
     *  has no host — which makes it something this window will not load. */
    private fun originOf(uri: Uri): String? {
        val scheme = uri.scheme ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host ?: return null
        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "$scheme://$host$port"
    }

    private fun showFailure(error: Throwable) {
        splash.alpha = 1f
        splash.visibility = View.VISIBLE
        val bar = splash.findViewById<ProgressBar>(R.id.splash_bar)
        bar?.visibility = View.GONE
        val text = splash.findViewById<android.widget.TextView>(R.id.splash_text)
        text?.text = error.message ?: getString(R.string.err_kernel_unreachable)
        text?.visibility = View.VISIBLE
        val retry = splash.findViewById<android.widget.Button>(R.id.splash_retry)
        retry?.visibility = View.VISIBLE
        retry?.setOnClickListener { recreate() }
    }

    private fun openExternally(url: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            // Nothing on the device claims this scheme; saying so would be worse
            // than the tap doing nothing.
        }
    }

    /**
     * A download the page asked for.
     *
     * The name comes from the response's own `Content-Disposition` when it has
     * one, because that is the name the kernel chose for the file; the URL's last
     * segment is the fallback. The picker is the system's, so the person decides
     * where it lands and the app needs no storage permission.
     */
    private fun beginDownload(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        val name = filenameFrom(contentDisposition, url) ?: getString(R.string.download_default_name)
        pendingDownload = PendingDownload(url, userAgent.orEmpty(), mimeType.orEmpty(), name)
        runCatching { saveDownload.launch(name) }
            .onFailure { pendingDownload = null }
    }

    private fun filenameFrom(contentDisposition: String?, url: String): String? {
        contentDisposition?.let { header ->
            // filename*=UTF-8''… comes first: it is the one that survives a
            // non-ASCII name, which a Chinese filename always is.
            val extended = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(header)
            if (extended != null) {
                return runCatching { java.net.URLDecoder.decode(extended.groupValues[1], "UTF-8") }.getOrNull()
            }
            val plain = Regex("filename=\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(header)
            if (plain != null) return plain.groupValues[1]
        }
        return runCatching {
            URL(url).path.substringAfterLast('/').takeIf { it.isNotBlank() }?.let {
                java.net.URLDecoder.decode(it, "UTF-8")
            }
        }.getOrNull()
    }

    /**
     * Handle an async call from the page's `window.reasonixHost` Promise
     * methods.
     *
     * Runs on the WebView's JavaScript thread and never on the UI thread: the
     * calls that need an activity result — a folder, a place to save — block on
     * a latch until that activity answers, and waiting on the UI thread would
     * stop the very callback that releases them. Anything that must happen on
     * the UI thread is posted there by the callee.
     */
    private fun handleHostCall(id: String, method: String, args: String) {
        try {
            when (method) {
                "syncTheme" -> {
                    val scheme = JSONArray(args).optString(0, "light")
                    runOnUiThread { syncWindowTheme(scheme) }
                    replyHost(id, "null")
                }
                "pickFolder" -> {
                    val startIn = JSONArray(args).optString(0, "")
                    if (nativeResults.isNotEmpty()) {
                        replyHost(id, JSONObject.quote(""))
                    } else {
                        nativeResults[method] = id
                        runOnUiThread {
                            runCatching { folders.pick(startIn) }
                                .onFailure { finishNativePicker(method, null) }
                        }
                    }
                }
                // A save waits for the person to choose a place, and the answer
                // comes back as an activity result. Waiting for it here would
                // hold the page's own script thread for as long as the picker is
                // open, so the wait happens off it and the Promise is answered
                // when the result lands.
                "saveText" -> {
                    val arr = JSONArray(args)
                    val name = arr.optString(0, "reasonix.txt")
                    val content = arr.optString(1, "")
                    Thread({
                        val saved = bridge.saveFile(name, content.toByteArray(Charsets.UTF_8))
                        replyHost(id, JSONObject.quote(saved.orEmpty()))
                    }, "bridge-save").start()
                }
                "saveBytes" -> {
                    val arr = JSONArray(args)
                    val name = arr.optString(0, "reasonix.bin")
                    val base64 = arr.optString(1, "")
                    Thread({
                        val bytes = runCatching { android.util.Base64.decode(base64, android.util.Base64.DEFAULT) }
                            .getOrNull()
                        val saved = bytes?.let { bridge.saveFile(name, it) }
                        replyHost(id, JSONObject.quote(saved.orEmpty()))
                    }, "bridge-save").start()
                }
                else -> replyHost(id, "null")
            }
        } catch (_: Exception) {
            replyHost(id, "null")
        }
    }

    /** Push a result back to the page's pending Promise. */
    private fun replyHost(id: String, json: String) {
        web.post {
            web.evaluateJavascript(
                "window.__reasonixHostReply && window.__reasonixHostReply(${JSONObject.quote(id)}, ${JSONObject.quote(json)});",
                null,
            )
        }
    }

    /**
     * Inject `window.reasonixHost` into the page.
     *
     * A WebView has no preload script, so the shell's interface is built here
     * after the document loads and before the page asks for it. The methods are
     * Promise-based, matching the shape the desktop shell exposes, and the round
     * trip is `hostCall` out and `__reasonixHostReply` back because
     * `@JavascriptInterface` is synchronous.
     *
     * Only the verbs this shell really answers are defined. That is the same
     * convention the desktop bridge uses for what it lacks: a missing method is
     * how the page learns it has no such verb rather than calling one that
     * silently does nothing.
     */
    private fun injectHostBridge() {
        web.evaluateJavascript(
            """
(function() {
  if (window.reasonixHost) return;
  var pending = {};
  var nextId = 1;
  window.__reasonixHostReply = function(id, jsonStr) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    try { entry.resolve(JSON.parse(jsonStr)); } catch (e) { entry.resolve(null); }
  };
  function call(method, args) {
    return new Promise(function(resolve, reject) {
      var id = String(nextId++);
      pending[id] = { resolve: resolve, reject: reject };
      try {
        ReasonixNative.hostCall(id, method, JSON.stringify(args || []));
      } catch (e) {
        delete pending[id];
        reject(e);
      }
    });
  }
  function base64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  window.reasonixHost = {
    shell: 'electron',
    platform: 'android',
    titleBar: false,
    syncTheme: function(mode, scheme) { return call('syncTheme', [scheme]); },
    pickFolder: function(startIn) { return call('pickFolder', [startIn]); },
    saveText: function(name, content) { return call('saveText', [name, content]); },
    saveBytes: function(name, bytes) { return call('saveBytes', [name, base64(bytes)]); },
    openExternal: function(url) { ReasonixNative.openExternal(url); return Promise.resolve(); },
    setUnreadBadge: function() { return Promise.resolve(); }
  };
  window.dispatchEvent(new Event('reasonix-host-ready'));
})();
            """.trimIndent(),
            null,
        )
    }

    override fun onPause() {
        super.onPause()
        // The page keeps its own state; the shell stops the timers that cost
        // battery while it is not being looked at.
        web.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // The window keeps its view across a rotation, a fold and a split, so
        // the bars can have moved without the listener ever running.
        ViewCompat.requestApplyInsets(rootLayout)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // A rotation keeps this Activity, so only this asks the listener again
        // for the bars on the new long edge.
        ViewCompat.requestApplyInsets(rootLayout)
    }

    override fun onDestroy() {
        if (isFinishing) {
            // Swiping the app away means "stop": the kernel is this app's child,
            // and leaving it running with nothing to show it would be a process
            // nobody can reach or stop.
            KernelService.stop(this)
            (application as App).kernel.stop()
        } else {
            // A configuration change: the page is rebuilt from the kernel, which
            // is still running.
            web.destroy()
        }
        super.onDestroy()
    }
}
