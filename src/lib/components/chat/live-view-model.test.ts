import { describe, expect, it } from "vitest";
import { createLiveViewModel } from "./live-view-model";

describe("createLiveViewModel", () => {
  it("reads current values instead of capturing construction-time snapshots", () => {
    let timeline = ["initial"];
    let loading = true;

    const viewModel = createLiveViewModel({
      timeline: () => timeline,
      loading: () => loading,
    });

    expect(viewModel.timeline).toEqual(["initial"]);
    expect(viewModel.loading).toBe(true);

    timeline = ["loaded", "message"];
    loading = false;

    expect(viewModel.timeline).toEqual(["loaded", "message"]);
    expect(viewModel.loading).toBe(false);
  });

  it("keeps a stable object identity while exposing every selector", () => {
    const onSelect = () => "selected";
    const viewModel = createLiveViewModel({
      count: () => 1,
      onSelect: () => onSelect,
    });

    expect(Object.keys(viewModel)).toEqual(["count", "onSelect"]);
    expect(viewModel.onSelect).toBe(onSelect);
    expect(viewModel).toBe(viewModel);
  });
});
