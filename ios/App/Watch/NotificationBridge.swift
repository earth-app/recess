import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit

// Bridges iPhone-originated notifications and snapshot updates onto the wrist.
// Ported from sky, where this exact shape is in production.
public final class NotificationBridgeWatchDelegate: NSObject, WKApplicationDelegate, WCSessionDelegate,
    UNUserNotificationCenterDelegate
{
    public static let snapshotChanged = Notification.Name("recessSnapshotChanged")

    public func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
        activateSession()
    }

    public func applicationDidBecomeActive() {
        // WCSession deactivates when the watch sleeps; bring it back on wake
        activateSession()
    }

    private func activateSession() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.activationState != .activated {
            session.delegate = self
            session.activate()
        }
    }

    // MARK: WCSession

    public func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error = error {
            NSLog("[RecessWatch] activation error: \(error.localizedDescription)")
        }
    }

    /// interactive; the phone is reachable and the watch app is running
    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleIncoming(message)
    }

    /// queued and durable; survives off-wrist and out-of-range periods
    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handleIncoming(userInfo)
    }

    public func sessionReachabilityDidChange(_ session: WCSession) {}

    private func handleIncoming(_ payload: [String: Any]) {
        switch payload["type"] as? String {
        case "snapshot.update":
            persistSnapshot(payload)
        case "notification.deliver":
            deliverNotification(payload)
        default:
            break
        }
    }

    /// mirror the phone's snapshot into the shared suite so the views can read it
    /// even when the widget timeline has not refreshed yet
    private func persistSnapshot(_ payload: [String: Any]) {
        var stripped = payload
        stripped.removeValue(forKey: "type")

        guard let defaults = UserDefaults(suiteName: RecessSnapshotStore.appGroup),
              let data = try? JSONSerialization.data(withJSONObject: stripped),
              let json = String(data: data, encoding: .utf8)
        else { return }

        defaults.set(json, forKey: RecessSnapshotStore.key)
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: Self.snapshotChanged, object: nil)
        }
    }

    private func deliverNotification(_ payload: [String: Any]) {
        guard let id = payload["id"] as? String,
              let title = payload["title"] as? String
        else { return }

        let body = payload["body"] as? String ?? ""
        let route = payload["route"] as? String ?? ""

        requestAuthorizationIfNeeded { granted in
            guard granted else { return }

            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            content.userInfo = route.isEmpty ? ["id": id] : ["route": route, "id": id]

            // a nil trigger will not deliver while the app is backgrounded; a tiny
            // interval trigger works in both states
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
            let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)

            UNUserNotificationCenter.current().add(request) { error in
                if let error = error {
                    NSLog("[RecessWatch] notification add failed: \(error.localizedDescription)")
                }
            }
        }
    }

    private func requestAuthorizationIfNeeded(_ completion: @escaping (Bool) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                completion(true)
            case .denied:
                completion(false)
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                    completion(granted)
                }
            @unknown default:
                completion(false)
            }
        }
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}
