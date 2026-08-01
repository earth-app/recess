import SwiftUI
import WidgetKit

// The target's floor is iOS 16.1, which is also ActivityKit's, so both widgets are
// unconditionally available and no availability juggling is needed here. That
// matters: `WidgetBundleBuilder` has no `buildEither`, and a nested WidgetBundle
// does not satisfy `some Widget`, so the usual if/else shapes do not compile.
@main
struct RecessWidgetBundle: WidgetBundle {
    var body: some Widget {
        RecessWidget()
        NudgeLiveActivity()
    }
}
