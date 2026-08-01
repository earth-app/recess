import Capacitor
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

// The one thing the App Group cannot do. Ported from sky's DistanceLiveActivityPlugin.
// Every method resolves rather than rejects when ActivityKit is unavailable, so the
// JS side never has to branch on OS version.
@objc(NudgeLiveActivityPlugin)
public class NudgeLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NudgeLiveActivityPlugin"
    public let jsName = "NudgeLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    #if canImport(ActivityKit)
    private var activityId: String?
    #endif

    @objc func isSupported(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
            call.resolve(["supported": enabled])
            return
        }
        #endif
        call.resolve(["supported": false])
    }

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.resolve(["started": false, "reason": "disabled"])
                return
            }

            let title = call.getString("title") ?? "Recess"
            let category = call.getString("category") ?? "nudge"
            let points = call.getInt("points") ?? 0
            let symbol = call.getString("symbol") ?? "leaf"
            let seconds = call.getDouble("seconds") ?? 600

            let attributes = NudgeActivityAttributes(
                title: title,
                category: category,
                points: points,
                symbol: symbol
            )
            let state = NudgeActivityAttributes.ContentState(
                endsAt: Date().addingTimeInterval(seconds)
            )

            do {
                let activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: state, staleDate: nil)
                )
                activityId = activity.id
                call.resolve(["started": true, "id": activity.id])
            } catch {
                call.resolve(["started": false, "reason": error.localizedDescription])
            }
            return
        }
        #endif
        call.resolve(["started": false, "reason": "unsupported"])
    }

    @objc func update(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let paused = call.getBool("paused") ?? false
            let seconds = call.getDouble("seconds")

            Task {
                for activity in Activity<NudgeActivityAttributes>.activities
                where activity.id == activityId {
                    let endsAt = seconds.map { Date().addingTimeInterval($0) }
                        ?? activity.content.state.endsAt
                    await activity.update(
                        .init(
                            state: .init(endsAt: endsAt, paused: paused),
                            staleDate: nil
                        )
                    )
                }
                call.resolve(["updated": true])
            }
            return
        }
        #endif
        call.resolve(["updated": false])
    }

    @objc func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                for activity in Activity<NudgeActivityAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
                activityId = nil
                call.resolve(["ended": true])
            }
            return
        }
        #endif
        call.resolve(["ended": false])
    }
}
