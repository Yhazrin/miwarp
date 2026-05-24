import SwiftUI

struct ApprovalCardView: View {
    let permission: PendingPermission
    var onApprove: ((Bool) -> Void)?

    var body: some View {
        MWApprovalCard(
            requestId: permission.id,
            toolName: permission.toolName,
            description: permission.description,
            onApprove: onApprove
        )
    }
}
