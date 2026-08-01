import Capacitor
import UIKit

// Scene lifecycle rather than the legacy app-delegate window. Apple asserts on
// apps that still create their own UIWindow in didFinishLaunching, so the window,
// deep links and web-content recovery all live here.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = UIStoryboard(name: "Main", bundle: nil).instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()

        // a launch from a home-screen shortcut arrives here, not in the app delegate
        if let shortcut = connectionOptions.shortcutItem {
            routeShortcut(shortcut)
        }

        for context in connectionOptions.urlContexts {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared,
                open: context.url,
                options: [:]
            )
        }
    }

    func scene(
        _ scene: UIScene,
        openURLContexts URLContexts: Set<UIOpenURLContext>
    ) {
        guard let context = URLContexts.first else { return }
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            open: context.url,
            options: [:]
        )
    }

    func scene(
        _ scene: UIScene,
        continue userActivity: NSUserActivity
    ) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        routeShortcut(shortcutItem)
        completionHandler(true)
    }

    /// Hands a shortcut's route to the webview through the App Group, the same suite the widget
    /// and watch read. A cold launch arrives before the webview exists, so the route has to be
    /// parked somewhere durable rather than posted to a bus nothing is on yet; the JS side picks
    /// it up on boot and on resume, then clears it.
    private func routeShortcut(_ shortcut: UIApplicationShortcutItem) {
        guard let route = shortcut.userInfo?["route"] as? String else { return }
        RecessShortcutStore.park(route)
    }
}

enum RecessShortcutStore {
    static let appGroup = "group.com.earthapp.recess"
    static let key = "recess.shortcutRoute"

    /// Written under both the raw and prefixed key, because which one Capacitor Preferences reads
    /// back depends on whether `configure({ group })` has landed yet on this launch.
    static func park(_ route: String) {
        guard let defaults = UserDefaults(suiteName: appGroup) else { return }
        for candidate in [key, "CapacitorStorage.\(key)"] {
            defaults.set(route, forKey: candidate)
        }
    }
}
