import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AnswerText, VerificationBadge } from "../components/Answer";
import { LineChart } from "../components/Charts";
import { fmt } from "../lib/api";
import Landing from "../pages/Landing";

describe("AnswerText", () => {
  it("renders citation chips that report which source was clicked", () => {
    const onCite = vi.fn();
    render(<AnswerText text="Leave is **24 days** [1]. Carry-over is 5 days [2]." onCite={onCite} citable={new Set([1, 2])} />);
    expect(screen.getByText("24 days").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "Show source 2" }));
    expect(onCite).toHaveBeenCalledWith(2);
  });

  it("hides citations that have no matching source and renders lists", () => {
    render(<AnswerText text={"- first [1]\n- second [7]"} citable={new Set([1])} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Show source 7" })).toBeNull();
  });

  it("never renders raw HTML from the model", () => {
    const { container } = render(<AnswerText text={'<img src=x onerror="alert(1)"> hello'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });
});

describe("VerificationBadge", () => {
  it("shows refusals and partial support distinctly", () => {
    const { rerender } = render(<VerificationBadge trace={{}} answered={false} />);
    expect(screen.getByText(/Not found in your documents/)).toBeInTheDocument();
    rerender(<VerificationBadge trace={{ verification: { faithfulness: 0.5, unsupported: ["x"] } }} answered />);
    expect(screen.getByText(/50% of claims supported/)).toBeInTheDocument();
  });
});

describe("charts and formatting", () => {
  it("line chart offers a table view", () => {
    render(<LineChart title="Hit rate" points={[{ label: "a", value: 0.5 }, { label: "b", value: 1 }]} format={fmt.pct} max={1} />);
    fireEvent.click(screen.getByText("Show as table"));
    expect(screen.getByRole("table")).toHaveTextContent("100%");
  });

  it("formats numbers", () => {
    expect(fmt.ms(1530)).toBe("1.5 s");
    expect(fmt.pct(0.873)).toBe("87%");
    expect(fmt.usd(0.00012)).toBe("$0.0001");
  });
});

it("landing page explains the pipeline and links to sign-up", () => {
  render(<MemoryRouter><Landing /></MemoryRouter>);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ask your documents");
  expect(screen.getAllByRole("link", { name: /Create/ })[0]).toHaveAttribute("href", "/signup");
  expect(screen.getByRole("img", { name: /pipeline/ })).toBeInTheDocument();
});
