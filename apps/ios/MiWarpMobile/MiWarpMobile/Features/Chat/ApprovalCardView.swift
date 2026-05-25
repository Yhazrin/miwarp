import SwiftUI

struct ApprovalCardView: View {
    let permission: PendingPermission
    var onApprove: ((Bool) -> Void)?

    var body: some View {
        InlineApprovalView(
            toolName: permission.toolName,
            description: permission.description,
            onApprove: onApprove
        )
    }
}
