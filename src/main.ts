import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath } from "obsidian";
import {
	Decision,
	LOG_PATH,
	LOG_TEMPLATE,
	FOLDER,
	RULES_PATH,
	RULES_TEMPLATE,
	logMoved,
	logUnmatched,
	nameKey,
	parseRules,
	plan,
	reportedUnmatched,
	stamp,
} from "./logic";

interface Settings {
	quietSeconds: number;
}

// 5 minút: Remotely Save prenáša úpravy z mobilu s oneskorením, kratší čas by mohol presunúť poznámku,
// ktorú používateľ v mobile ešte píše (po synchronizácii by vznikla kópia v koreni).
const DEFAULTS: Settings = { quietSeconds: 300 };
// Automatika je nastavenie zariadenia (localStorage), nie vaultu: dá sa zapnúť len na jednom zariadení.
// Predvolene zapnuté na každom zariadení (Mac, iPhone, iPad); dá sa vypnúť pre jedno zariadenie.
const AUTO_KEY = "triedic-auto";
const TICK_MS = 60_000;
const STARTUP_DELAY_MS = 30_000;

export default class TriedicPlugin extends Plugin {
	settings: Settings = { ...DEFAULTS };
	private running = false;
	private timer: number | null = null;
	private reported: Set<string> | null = null;

	async onload(): Promise<void> {
		this.settings = { ...DEFAULTS, ...((await this.loadData()) as Partial<Settings> | null) };
		this.addSettingTab(new TriedicSettingTab(this.app, this));

		this.addRibbonIcon("folder-input", "Triedič poznámok: náhľad", () => void this.openPreview());
		this.addCommand({ id: "sort-now", name: "Roztrieď teraz", callback: () => void this.sort(true) });
		this.addCommand({ id: "preview", name: "Náhľad: čo by sa kam presunulo", callback: () => void this.openPreview() });
		this.addCommand({ id: "open-rules", name: "Otvoriť pravidlá", callback: () => void this.openNote(RULES_PATH) });
		this.addCommand({ id: "open-log", name: "Otvoriť denník", callback: () => void this.openNote(LOG_PATH) });

		this.app.workspace.onLayoutReady(async () => {
			await this.ensureRules();
			// Udalosti až po načítaní vaultu, inak by „create“ prišlo pre každý súbor.
			this.registerEvent(this.app.vault.on("create", () => this.schedule()));
			this.registerEvent(this.app.vault.on("rename", () => this.schedule()));
			this.registerEvent(this.app.vault.on("modify", (f) => f.parent?.isRoot() && this.schedule()));
			// Keď odídeš z poznámky, môže ísť na svoje miesto.
			this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.schedule(3000)));
			this.registerInterval(window.setInterval(() => void this.autoSort(), TICK_MS));
			// Po štarte najprv nechaj Remotely Save dobehnúť synchronizáciu.
			this.schedule(STARTUP_DELAY_MS);
		});
	}

	onunload(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
	}

	get auto(): boolean {
		const v: unknown = this.app.loadLocalStorage(AUTO_KEY);
		return v !== "off";
	}

	set auto(on: boolean) {
		this.app.saveLocalStorage(AUTO_KEY, on ? "on" : "off");
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private schedule(delay = this.settings.quietSeconds * 1000 + 2000): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.autoSort();
		}, delay);
	}

	private async autoSort(): Promise<void> {
		if (this.auto) await this.sort(false);
	}

	/** Pravidlá a denník; keď chýbajú, vytvorí ich zo vzoru. */
	private async ensureRules(): Promise<void> {
		const { vault } = this.app;
		if (!vault.getAbstractFileByPath(FOLDER)) await vault.createFolder(FOLDER).catch(() => undefined);
		if (!vault.getAbstractFileByPath(RULES_PATH)) await vault.create(RULES_PATH, RULES_TEMPLATE).catch(() => undefined);
		if (!vault.getAbstractFileByPath(LOG_PATH)) await vault.create(LOG_PATH, LOG_TEMPLATE).catch(() => undefined);
	}

	private async readRules() {
		const f = this.app.vault.getFileByPath(RULES_PATH);
		return f ? parseRules(await this.app.vault.cachedRead(f)) : [];
	}

	/** Priečinok vo vaulte s rovnakým menom (bez ohľadu na NFC/NFD a veľké písmená). */
	private findFolder(path: string): TFolder | null {
		const exact = this.app.vault.getFolderByPath(normalizePath(path));
		if (exact) return exact;
		const key = nameKey(path);
		return this.app.vault.getAllFolders(false).find((f) => nameKey(f.path) === key) ?? null;
	}

	/** Len mená .md súborov v koreni. Obsah poznámok sa nečíta. */
	async makePlan(manual: boolean): Promise<Decision[]> {
		const active = this.app.workspace.getActiveFile();
		const root = this.app.vault.getRoot();
		const candidates = root.children
			.filter((f): f is TFile => f instanceof TFile && f.extension === "md")
			.map((f) => ({ basename: f.basename, path: f.path, mtime: f.stat.mtime, isOpen: f === active }));
		return plan({
			candidates,
			rules: await this.readRules(),
			now: Date.now(),
			quietMs: manual ? 0 : this.settings.quietSeconds * 1000,
			takenIn: (folder) => {
				const f = this.findFolder(folder);
				return new Set((f?.children ?? []).map((c) => nameKey(c.name)));
			},
		});
	}

	/** Jeden prechod. manual = tlačidlo „Roztrieď teraz“ (bez čakania na pokoj). */
	async sort(manual: boolean): Promise<number> {
		if (this.running) return 0;
		this.running = true;
		try {
			await this.ensureRules();
			const decisions = await this.makePlan(manual);
			const time = stamp(new Date());
			const lines: string[] = [];
			const reported = await this.getReported();
			let moved = 0;
			for (const d of decisions) {
				if (d.kind === "nomatch" && !reported.has(d.title)) {
					reported.add(d.title);
					lines.push(logUnmatched(time, d.title));
				}
				if (d.kind !== "move") continue;
				const file = this.app.vault.getFileByPath(d.from);
				if (!file) continue;
				try {
					const folder = this.findFolder(d.folder) ?? (await this.app.vault.createFolder(normalizePath(d.folder)));
					const to = normalizePath(`${folder.path}/${d.to.slice(d.folder.length + 1)}`);
					if (this.app.vault.getAbstractFileByPath(to)) continue; // istota: nič neprepisovať
					// Presun cez Obsidian: aktualizuje odkazy a synchronizácia vidí presun, nie kópiu.
					await this.app.fileManager.renameFile(file, to);
					moved++;
					lines.push(logMoved(time, d.title, to));
				} catch (e) {
					lines.push(`- ${time} · ⚠️ „${d.title}“ sa nepodarilo presunúť: ${e instanceof Error ? e.message : String(e)}`);
				}
			}
			await this.appendLog(lines);
			if (manual) new Notice(moved ? `Triedič: presunuté ${moved}` : "Triedič: nič na presun");
			return moved;
		} finally {
			this.running = false;
		}
	}

	private async getReported(): Promise<Set<string>> {
		if (!this.reported) {
			const f = this.app.vault.getFileByPath(LOG_PATH);
			this.reported = f ? reportedUnmatched(await this.app.vault.cachedRead(f)) : new Set();
		}
		return this.reported;
	}

	private async appendLog(lines: string[]): Promise<void> {
		if (!lines.length) return;
		const { vault } = this.app;
		const text = lines.join("\n") + "\n";
		const f = vault.getFileByPath(LOG_PATH);
		if (f) await vault.process(f, (old) => (old.endsWith("\n") || !old ? old : old + "\n") + text);
		else await vault.create(LOG_PATH, LOG_TEMPLATE + text);
	}

	async openNote(path: string): Promise<void> {
		await this.ensureRules();
		await this.app.workspace.openLinkText(path, "", true);
	}

	async openPreview(): Promise<void> {
		await this.ensureRules();
		new PreviewModal(this.app, this, await this.makePlan(true)).open();
	}
}

class PreviewModal extends Modal {
	constructor(
		app: App,
		private plugin: TriedicPlugin,
		private decisions: Decision[],
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle("Náhľad triedenia");
		const moves = this.decisions.filter((d) => d.kind === "move");
		const waits = this.decisions.filter((d) => d.kind === "wait");
		const none = this.decisions.filter((d) => d.kind === "nomatch");

		const section = (title: string, items: string[]) => {
			if (!items.length) return;
			contentEl.createEl("h4", { text: title });
			const ul = contentEl.createEl("ul");
			for (const t of items) ul.createEl("li", { text: t });
		};
		if (!this.decisions.length) contentEl.createEl("p", { text: "V koreni vaultu nie je nič na triedenie." });
		section(
			"Presunie sa",
			moves.map((d) => (d.kind === "move" ? `${d.title} → ${d.to}` : "")),
		);
		section(
			"Zatiaľ nechá na pokoji",
			waits.map((d) => (d.kind === "wait" ? `${d.title} (${d.reason})` : "")),
		);
		section(
			"Nesedí na žiadne pravidlo",
			none.map((d) => d.title),
		);

		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText("Upraviť pravidlá").onClick(() => {
					this.close();
					void this.plugin.openNote(RULES_PATH);
				}),
			)
			.addButton((b) =>
				b
					.setButtonText(`Roztrieď teraz (${moves.length})`)
					.setCta()
					.setDisabled(!moves.length)
					.onClick(async () => {
						this.close();
						await this.plugin.sort(true);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class TriedicSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: TriedicPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("p", {
			text: "Poznámky v koreni vaultu sa presúvajú do priečinkov podľa začiatku nadpisu. Pravidlá sú v _Triedenie/Pravidlá.md, záznam v _Triedenie/Denník.md. Číta len mená súborov, nič neposiela na internet.",
		});

		new Setting(containerEl)
			.setName("Triediť automaticky na tomto zariadení")
			.setDesc("Platí len pre toto zariadenie. Predvolene zapnuté všade, aj v iPhone a iPade.")
			.addToggle((t) => t.setValue(this.plugin.auto).onChange((v) => (this.plugin.auto = v)));

		new Setting(containerEl)
			.setName("Počkať po poslednej úprave (sekundy)")
			.setDesc("Poznámku, ktorú práve píšeš alebo máš otvorenú, nechá na pokoji.")
			.addText((t) =>
				t.setValue(String(this.plugin.settings.quietSeconds)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 0) {
						this.plugin.settings.quietSeconds = Math.round(n);
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Ručne")
			.addButton((b) => b.setButtonText("Náhľad").onClick(() => void this.plugin.openPreview()))
			.addButton((b) => b.setButtonText("Pravidlá").onClick(() => void this.plugin.openNote(RULES_PATH)))
			.addButton((b) => b.setButtonText("Denník").onClick(() => void this.plugin.openNote(LOG_PATH)))
			.addButton((b) => b.setButtonText("Roztrieď teraz").setCta().onClick(() => void this.plugin.sort(true)));
	}
}
