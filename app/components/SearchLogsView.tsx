// SearchLogsView is deprecated and replaced by InsightsView. This
// file is kept only as a back-compat re-export so any stale import
// still resolves; new code should import InsightsView directly.
//
// TODO: delete this file once we've confirmed no other entry points
// still reference SearchLogsView.

export { default } from "./InsightsView";
