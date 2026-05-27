import SwiftUI

struct MessageTimeline: View {
    let messages: [DisplayMessage]
    let complexityMode: ComplexityMode
    var inputBarHeight: CGFloat = 60
    var pendingPermissions: [PendingPermission] = []
    var onApprove: ((String, Bool) -> Void)?
    var toastPresenter: MiToastPresenter?

    var body: some View {
        MessageListView(
            messages: messages,
            complexityMode: complexityMode,
            inputBarHeight: inputBarHeight,
            onApprove: onApprove
        )
    }
}
