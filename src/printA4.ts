import { PAGE_W, PAGE_H, PAGE_MARGIN, pageTop } from "./geometry";

const SVG_NS = "http://www.w3.org/2000/svg";

// Print the diagram as true vector A4 pages. Each page is one A4 sheet showing
// its slice of the canvas. The live stylesheet still cascades in print, and
// @media print pins the light palette — so we rely on CSS (not baked styles),
// only forwarding the label scale onto the print root.
interface PrintIdentity {
	name: string;
	studentNumber: string;
}

export function printA4(svg: SVGSVGElement, pages: number, identity?: PrintIdentity) {
	const content = svg.querySelector("#content");
	if (!content) return;
	const ls = getComputedStyle(svg).getPropertyValue("--label-scale") || "1";

	const root = document.createElement("div");
	root.className = "print-root";
	root.style.setProperty("--label-scale", ls);

	for (let i = 0; i < pages; i++) {
		const top = pageTop(i);

		const pageDiv = document.createElement("div");
		pageDiv.className = "print-page";

		const psvg = document.createElementNS(SVG_NS, "svg");
		psvg.setAttribute("xmlns", SVG_NS);
		psvg.setAttribute("viewBox", `0 ${top} ${PAGE_W} ${PAGE_H}`);
		psvg.setAttribute("preserveAspectRatio", "xMidYMid meet");

		// white page background
		const bg = document.createElementNS(SVG_NS, "rect");
		bg.setAttribute("x", "0");
		bg.setAttribute("y", String(top));
		bg.setAttribute("width", String(PAGE_W));
		bg.setAttribute("height", String(PAGE_H));
		bg.setAttribute("fill", "#ffffff");
		psvg.appendChild(bg);

		// the diagram content (clipped to the page by the svg viewport)
		const c = content.cloneNode(true) as Element;
		c.querySelectorAll(".ui-only").forEach((el) => el.remove());
		c.querySelectorAll(".free-text.placeholder, .image-annotation-text.placeholder").forEach((el) => el.remove());
		c.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
		psvg.appendChild(c);

		const name = identity?.name.trim() ?? "";
		const studentNumber = identity?.studentNumber.trim() ?? "";
		if (name || studentNumber) {
			const headerY = top + PAGE_MARGIN * 0.55;
			const headerBg = document.createElementNS(SVG_NS, "rect");
			headerBg.setAttribute("x", String(PAGE_MARGIN - 8));
			headerBg.setAttribute("y", String(top + 12));
			headerBg.setAttribute("width", String(PAGE_W - 2 * PAGE_MARGIN + 16));
			headerBg.setAttribute("height", String(PAGE_MARGIN * 0.65));
			headerBg.setAttribute("fill", "#ffffff");
			psvg.appendChild(headerBg);

			if (name) {
				const nameText = document.createElementNS(SVG_NS, "text");
				nameText.setAttribute("x", String(PAGE_MARGIN));
				nameText.setAttribute("y", String(headerY));
				nameText.setAttribute("fill", "#1d2433");
				nameText.setAttribute("font-size", "16");
				nameText.setAttribute("font-family", "sans-serif");
				nameText.textContent = name;
				psvg.appendChild(nameText);
			}

			if (studentNumber) {
				const studentText = document.createElementNS(SVG_NS, "text");
				studentText.setAttribute("x", String(PAGE_W - PAGE_MARGIN));
				studentText.setAttribute("y", String(headerY));
				studentText.setAttribute("fill", "#1d2433");
				studentText.setAttribute("font-size", "16");
				studentText.setAttribute("font-family", "sans-serif");
				studentText.setAttribute("text-anchor", "end");
				studentText.textContent = studentNumber;
				psvg.appendChild(studentText);
			}

			const rule = document.createElementNS(SVG_NS, "line");
			rule.setAttribute("x1", String(PAGE_MARGIN));
			rule.setAttribute("x2", String(PAGE_W - PAGE_MARGIN));
			rule.setAttribute("y1", String(top + PAGE_MARGIN * 0.72));
			rule.setAttribute("y2", String(top + PAGE_MARGIN * 0.72));
			rule.setAttribute("stroke", "#8b97a8");
			rule.setAttribute("stroke-width", "1");
			psvg.appendChild(rule);
		}

		pageDiv.appendChild(psvg);
		root.appendChild(pageDiv);
	}

	document.body.appendChild(root);
	const cleanup = () => {
		root.remove();
		window.removeEventListener("afterprint", cleanup);
	};
	window.addEventListener("afterprint", cleanup);
	window.print();
}
