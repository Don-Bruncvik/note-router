// Čistá logika triediča (bez Obsidianu), aby sa dala testovať.
// Prenesené z ~/Documents/DEV/obsidian-triedic/triedic.py.

export const FOLDER = "_Triedenie";
export const RULES_PATH = `${FOLDER}/Pravidlá.md`;
export const LOG_PATH = `${FOLDER}/Denník.md`;

export const RULES_TEMPLATE = `# Pravidlá triedenia

Poznámka v koreni vaultu sa presunie podľa toho, **ako začína jej nadpis**.
Riadok pravidla: \`slová na začiatku nadpisu = priečinok\`. Viac slov oddeľ čiarkou.
Veľké písmená a diakritika nehrajú rolu. Vyhrá najdlhšia zhoda.
Poznámka, ktorá nesedí na žiadne pravidlo, zostane v koreni a zapíše sa do denníka.

## Pravidlá

- KAM = KAM
- Talent, FMK = Talent FMK
- UTB, Copywriting, Direct Marketing, Brandbuilding, Mediálne plánovanie, Meta business, Angličtina = ÚMK 3. roč
`;

export const LOG_TEMPLATE = "# Denník triedenia\n\nNajnovšie dole.\n\n";

export interface Rule {
	key: string; // normalizovaný začiatok nadpisu
	folder: string; // cieľový priečinok, tak ako je napísaný v pravidlách
}

/** Malé písmená, bez diakritiky, jedna medzera. */
export function normalize(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

const RULE_RE = /^\s*[-*]?\s*([^=`#]+?)\s*=\s*([^=`]+?)\s*$/;

/** Bezpečný cieľ: vo vnútri vaultu, nie skrytý priečinok (.obsidian), nie _Triedenie. */
export function safeFolder(raw: string): string | null {
	const folder = raw.trim().replace(/^\/+|\/+$/g, "").normalize("NFC");
	if (!folder) return null;
	const parts = folder.split("/");
	if (parts.some((p) => p.trim() === "" || p === "." || p === ".." || p.startsWith("."))) return null;
	if (normalize(parts[0]) === normalize(FOLDER)) return null;
	return folder;
}

/** Číta len časť pod nadpisom „## Pravidlá“. Najdlhší kľúč je prvý. */
export function parseRules(text: string): Rule[] {
	const rules: Rule[] = [];
	let inList = false;
	for (const line of text.split(/\r?\n/)) {
		const t = line.trim();
		if (normalize(t).startsWith("## pravidl")) {
			inList = true;
			continue;
		}
		if (t.startsWith("#")) inList = false;
		if (!inList) continue;
		const m = RULE_RE.exec(line);
		if (!m) continue;
		const folder = safeFolder(m[2]);
		if (!folder) continue;
		for (const k of m[1].split(",")) {
			const key = normalize(k);
			if (key) rules.push({ key, folder });
		}
	}
	return rules.sort((a, b) => b.key.length - a.key.length);
}

/** Priečinok pre nadpis, alebo null. Kľúč musí byť celé slovo („KAM“ nesedí na „Kamarát“). */
export function findFolder(title: string, rules: Rule[]): string | null {
	const n = normalize(title);
	for (const r of rules) {
		if (n === r.key) return r.folder;
		if (n.startsWith(r.key) && !/[\p{L}\p{N}]/u.test(n[r.key.length])) return r.folder;
	}
	return null;
}

const UNTOUCHED = /^(untitled|bez nazvu|new note|nova poznamka|nepomenovane)( \d+)?$/;

/** Prázdne mená, ktoré Obsidian dáva novým poznámkam. Tie nechávame na pokoji. */
export function isPlaceholderName(title: string): boolean {
	return UNTOUCHED.test(normalize(title));
}

/** Kľúč na porovnanie mien súborov (macOS a iOS nerozlišujú veľkosť písmen ani NFC/NFD). */
export function nameKey(name: string): string {
	return name.normalize("NFC").toLowerCase();
}

/** Voľné meno v cieli: „X.md“, inak „X (2).md“, „X (3).md“… */
export function freeName(basename: string, ext: string, taken: Set<string>): string {
	const suffix = ext ? `.${ext}` : "";
	let name = `${basename}${suffix}`;
	for (let i = 2; taken.has(nameKey(name)); i++) name = `${basename} (${i})${suffix}`;
	return name;
}

export interface Candidate {
	basename: string;
	path: string;
	mtime: number;
	isOpen: boolean; // otvorená v aktívnej karte
}

export type Decision =
	| { kind: "move"; from: string; folder: string; to: string; title: string }
	| { kind: "wait"; title: string; reason: string }
	| { kind: "nomatch"; title: string };

export interface PlanInput {
	candidates: Candidate[];
	rules: Rule[];
	now: number;
	quietMs: number; // 0 = nečakať
	/** Mená súborov (nameKey), ktoré už v cieľovom priečinku sú. */
	takenIn: (folder: string) => Set<string>;
}

/** Plán presunov. Nič nerobí, len rozhodne. */
export function plan(input: PlanInput): Decision[] {
	const out: Decision[] = [];
	const reserved = new Map<string, Set<string>>();
	const sorted = [...input.candidates].sort((a, b) => a.path.localeCompare(b.path));
	for (const c of sorted) {
		if (isPlaceholderName(c.basename)) continue;
		const folder = findFolder(c.basename, input.rules);
		if (!folder) {
			out.push({ kind: "nomatch", title: c.basename });
			continue;
		}
		if (c.isOpen) {
			out.push({ kind: "wait", title: c.basename, reason: "máš ju otvorenú" });
			continue;
		}
		if (input.quietMs > 0 && input.now - c.mtime < input.quietMs) {
			out.push({ kind: "wait", title: c.basename, reason: "nedávno upravená" });
			continue;
		}
		const key = nameKey(folder);
		let taken = reserved.get(key);
		if (!taken) {
			taken = new Set(input.takenIn(folder));
			reserved.set(key, taken);
		}
		const name = freeName(c.basename, "md", taken);
		taken.add(nameKey(name));
		out.push({ kind: "move", from: c.path, folder, to: `${folder}/${name}`, title: c.basename });
	}
	return out;
}

/** Nadpisy, ktoré už denník hlásil ako nezaradené (aby sa nehlásili stále dokola). */
export function reportedUnmatched(logText: string): Set<string> {
	const s = new Set<string>();
	for (const m of logText.matchAll(/❓ „(.+?)“/g)) s.add(m[1]);
	return s;
}

export function stamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function logMoved(time: string, title: string, to: string): string {
	return `- ${time} · „${title}“ → [[${to.replace(/\.md$/, "")}]]`;
}

export function logUnmatched(time: string, title: string): string {
	return `- ${time} · ❓ „${title}“ nesedí na žiadne pravidlo, zostáva v koreni`;
}
