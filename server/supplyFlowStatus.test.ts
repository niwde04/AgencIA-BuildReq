import { describe, expect, it } from "vitest";
import { isSupplyFlowBlockingReassignment } from "@shared/supply-flow-status";

describe("supply flow reassignment status", () => {
  it.each(["pendiente", "en_proceso"])(
    "blocks reassignment while the flow is %s",
    status => {
      expect(isSupplyFlowBlockingReassignment(status)).toBe(true);
    }
  );

  it.each(["completado", "cancelado", null, undefined])(
    "allows reassignment after the historical flow is %s",
    status => {
      expect(isSupplyFlowBlockingReassignment(status)).toBe(false);
    }
  );
});
