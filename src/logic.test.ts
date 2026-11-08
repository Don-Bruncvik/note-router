import { describe, expect, it } from "vitest";
import {
	RULES_TEMPLATE,
	findFolder,
	freeName,
	isPlaceholderName,
	logMoved,
	logUnmatched,
	nameKey,
	normalize,
	parseRules,
	plan,
	reportedUnmatched,
	safeFolder,
} from "./logic";

const rules = parseRules(RULES_TEMPLATE);
const NOW = 1_000_000_000;
const old = NOW - 10 * 60_000;

describe("pravidlá", () => {
	it("čítajú vzor", () => {
		expect(findFolder("KAM porada 9.11", rules)).toBe("KAM");
		expect(findFolder("Copywriting zadanie 3", rules)).toBe("ÚMK 3. roč");
		expect(findFolder("mediálne plánovanie – úloha", rules)).toBe("ÚMK 3. roč");
		expect(findFolder("Medialne planovanie", rules)).toBe("ÚMK 3. roč");
		expect(findFolder("FMK porada", rules)).toBe("Talent FMK");
	});
	it("kľúč je celé slovo", () => {
		expect(findFolder("Kamarát", rules)).toBeNull();
		expect(findFolder("KAM", rules)).toBe("KAM");
		expect(findFolder("KAM: porada", rules)).toBe("KAM");
	});
	it("najdlhšia zhoda vyhrá", () => {
		const r = parseRules("## Pravidlá\n- KAM = KAM\n- KAM web = KAM/Web\n");
		expect(findFolder("KAM web návrh", r)).toBe("KAM/Web");
		expect(findFolder("KAM porada", r)).toBe("KAM");
	});
	it("ignorujú riadky mimo zoznamu a nebezpečné cesty", () => {
		const r = parseRules(
			"# Pravidlá\nA = Mimo\n## Pravidlá\n- B = ../von\n- C = .obsidian\n- D = _Triedenie\n- E = /Ok/\n## Iné\n- F = Nie\n",
		);
		expect(r).toEqual([{ key: "e", folder: "Ok" }]);
	});
	it("safeFolder", () => {
		expect(safeFolder(" ÚMK 3. roč/ ")).toBe("ÚMK 3. roč");
		expect(safeFolder("a//b")).toBeNull();
		expect(safeFolder("")).toBeNull();
	});
	it("normalize", () => {
		expect(normalize("  ÚMK   3. Roč ")).toBe("umk 3. roc");
	});
});

describe("mená", () => {
	it("pri zhode pridá (2), (3)", () => {
		expect(freeName("KAM test", "md", new Set())).toBe("KAM test.md");
		expect(freeName("KAM test", "md", new Set([nameKey("kam TEST.md")]))).toBe("KAM test (2).md");
		expect(freeName("KAM test", "md", new Set(["kam test.md", "kam test (2).md"]))).toBe("KAM test (3).md");
	});
	it("NFC/NFD je to isté meno", () => {
		expect(nameKey("Porada č.md".normalize("NFD"))).toBe(nameKey("Porada č.md"));
	});
	it("prázdne mená nechá", () => {
		expect(isPlaceholderName("Untitled")).toBe(true);
		expect(isPlaceholderName("Untitled 3")).toBe(true);
		expect(isPlaceholderName("Bez názvu")).toBe(true);
		expect(isPlaceholderName("KAM test")).toBe(false);
	});
});

describe("plán", () => {
	const base = { rules, now: NOW, quietMs: 120_000, takenIn: () => new Set<string>() };
	const c = (basename: string, extra: Partial<{ mtime: number; isOpen: boolean }> = {}) => ({
		basename,
		path: `${basename}.md`,
		mtime: old,
		isOpen: false,
		...extra,
	});

	it("presunie, počká a nahlási", () => {
		const d = plan({
			...base,
			candidates: [
				c("KAM test"),
				c("KAM práve píšem", { mtime: NOW - 5000 }),
				c("KAM otvorená", { isOpen: true }),
				c("Nákupný zoznam"),
				c("Untitled"),
			],
		});
		expect(d).toContainEqual({ kind: "move", from: "KAM test.md", folder: "KAM", to: "KAM/KAM test.md", title: "KAM test" });
		expect(d).toContainEqual({ kind: "wait", title: "KAM práve píšem", reason: "nedávno upravená" });
		expect(d).toContainEqual({ kind: "wait", title: "KAM otvorená", reason: "máš ju otvorenú" });
		expect(d).toContainEqual({ kind: "nomatch", title: "Nákupný zoznam" });
		expect(d.find((x) => x.title === "Untitled")).toBeUndefined();
	});
	it("ručne nečaká na pokoj, otvorenú však nechá", () => {
		const d = plan({ ...base, quietMs: 0, candidates: [c("KAM a", { mtime: NOW }), c("KAM b", { isOpen: true })] });
		expect(d.map((x) => x.kind)).toEqual(["move", "wait"]);
	});
	it("existujúce meno v cieli dostane (2)", () => {
		const d = plan({ ...base, takenIn: () => new Set(["kam test.md"]), candidates: [c("KAM test")] });
		expect(d[0]).toMatchObject({ kind: "move", to: "KAM/KAM test (2).md" });
	});
});

describe("denník", () => {
	it("zápis a spätné čítanie nezaradených", () => {
		expect(logMoved("2026-11-08 10:00", "KAM test", "KAM/KAM test.md")).toBe(
			"- 2026-11-08 10:00 · „KAM test“ → [[KAM/KAM test]]",
		);
		const text = logUnmatched("t", "Nákup") + "\n" + logUnmatched("t", "Iné");
		expect([...reportedUnmatched(text)]).toEqual(["Nákup", "Iné"]);
	});
});
