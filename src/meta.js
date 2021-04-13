import { DOMParser } from 'xmldom';

export class MetaInfoParser {
	/**
	 * @type {{[key in keyof MetaInfo as Exclude<key, "labelPage">]: (value: string | null) => MetaInfo[key]}}
	 */
	static converters = {
		title: String,
		sbnr: String,
		publisher: String,
		publisherweb: String,
		publisheradr: String,
		publishertel: String,
		publishermail: String,
		pageLabels: (value) => (value == null ? null : value.split(',')),
		firstPage: Number,
	};

	/**
	 * @param {Document | string} docOrSrc
	 * @returns {MetaInfo}
	 */
	static parse(docOrSrc) {
		const doc = typeof docOrSrc === 'string' ? new DOMParser().parseFromString(docOrSrc, 'text/html') : docOrSrc;
		const metas = Array.from(doc.documentElement.getElementsByTagName('meta'));
		/** @type {any} */
		const info = new MetaInfo();
		for (const meta of metas) {
			const name = meta.getAttribute('name');
			if (info.hasOwnProperty(name)) {
				const value = meta.getAttribute('content');
				info[name] = MetaInfoParser.converters[name](value);
			}
		}
		return info;
	}
}

export class MetaInfo {
	/** @type {string} */
	title;
	/** @type {string} */
	sbnr;
	/** @type {string} */
	publisher;
	/** @type {string} */
	publisherweb;
	/** @type {string} */
	publisheradr;
	/** @type {string} */
	publishertel;
	/** @type {string} */
	publishermail;
	/** @type {string[]} */
	pageLabels;
	/** @type {number} */
	firstPage;

	/**
	 * @see https://cdn.digi4school.at/viewer-2020/js/IDRViewerKMAddon.3.0.min.js?v=20210211#decodePageNumber
	 * @param {string | number} label
	 * @returns {number}
	 */
	labelPage(label) {
		if (this.pageLabels) {
			label = String(label).split('-')[0];
			const page = this.pageLabels.findIndex((l) => l == label);
			if (page != -1) return page + 1;
		} else if (this.firstPage) {
			label = String(label).replace(/\/.*/g, '');
			if (label.startsWith('U')) {
				const page = parseInt(label.substr(1));
				if (!isNaN(page)) return page;
			} else {
				const page = parseInt(label) + this.firstPage;
				if (!isNaN(page)) return page - 1;
			}
		} else if (typeof label === 'number' || label.match(/^\d+$/g)) {
			return Number(label);
		}

		throw new Error(`page label ${label} cannot be resolved`);
	}
}
