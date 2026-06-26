import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";

import ItemPerformance from "./ItemPerformance.jsx";

// spec 008: quick (uncatalogued) sales render as ONE synthetic row with revenue
// shown and profit shown as "—" (NOT 0 — the cost is unknown). It never becomes a
// per-item row and never claims a profit number.

const item = {
  itemId: "i1", name: "GM wire", sku: "WIR-1",
  qtySold: "4", revenue: "60000", grossProfit: "20000", stock: "96", image: null,
};
const quick = { qtySold: "12", revenue: "7000", lineCount: 2 };

function row(container, text) {
  return [...container.querySelectorAll("tr")].find((tr) => tr.textContent.includes(text)) || null;
}

describe("ItemPerformance — quick-sale synthetic row", () => {
  test("renders one 'Quick sales (uncatalogued)' row with revenue and profit shown as — (not 0)", () => {
    const { container } = render(<ItemPerformance items={[item]} deadStock={[]} quickSales={quick} />);
    const qrow = row(container, "Quick sales");
    expect(qrow).not.toBeNull();
    expect(qrow.textContent).toContain("(uncatalogued)");
    expect(qrow.textContent).toContain("12"); // qty rolled up
    expect(qrow.textContent).toContain("Rs 70.00"); // revenue shown
    // profit cell is an em dash, NOT a rupee zero
    expect(qrow.textContent).toContain("—");
    expect(qrow.textContent).not.toContain("Rs 0.00");
  });

  test("no quick row when there are no quick sales", () => {
    const { container } = render(<ItemPerformance items={[item]} deadStock={[]} quickSales={{ qtySold: "0", revenue: "0", lineCount: 0 }} />);
    expect(row(container, "Quick sales")).toBeNull();
  });

  test("a quick-only window still shows the table (not the empty message)", () => {
    const { container } = render(<ItemPerformance items={[]} deadStock={[]} quickSales={quick} />);
    expect(container.textContent).not.toContain("No sales in this window");
    expect(row(container, "Quick sales")).not.toBeNull();
  });

  test("the catalogued item still shows its real profit alongside", () => {
    const { container } = render(<ItemPerformance items={[item]} deadStock={[]} quickSales={quick} />);
    const irow = row(container, "GM wire");
    expect(irow.textContent).toContain("Rs 200.00"); // 20000 paisa gross profit
  });
});
