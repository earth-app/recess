import SwiftUI

@main
struct RecessWatchApp: App {
    @WKApplicationDelegateAdaptor(NotificationBridgeWatchDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
