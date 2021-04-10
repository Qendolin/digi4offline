import { retryAsync, ResponseError } from './util.js';
import fetch, { FetchError } from 'node-fetch';
import { DOMParser } from 'xmldom';

const metaInfoNames = [
	'title',
	'sbnr',
	'publisher',
	'publisherweb',
	'publisheradr',
	'publishertel',
	'publishermail',
	'pageLabels',
];

/**
 * @typedef MetaInfo
 * @property {string} title
 * @property {string} sbnr
 * @property {string} publisher
 * @property {string} publisherweb
 * @property {string} publisheradr
 * @property {string} publishertel
 * @property {string} publishermail
 * @property {string} pageLabels
 */

/**
 * @typedef {import('./auth').Cookies} Cookies
 * @typedef {import('./util').Range} Range
 */

/**
 * @typedef Options
 * @property {number} retryPage
 * @property {number} retryImage
 */

export class Book {
	/** @type {string} */
	id;
	/** @type {Cookies} */
	credentials;
	/** @type {Options} */
	options;

	/**
	 * @param {string} id
	 * @param {Cookies} creds
	 * @param {Options} [options]
	 */
	constructor(id, creds, options) {
		this.id = id;
		this.credentials = creds;
		this.options = {
			retryPage: 10,
			retryImage: 10,
			...options,
		};
	}

	get url() {
		return `https://a.digi4school.at/ebook/${this.id}/`;
	}

	/**
	 * @returns {Promise<MetaInfo>}
	 */
	async info() {
		const src = await fetch(`https://a.digi4school.at/ebook/${this.id}/`, {
			headers: {
				accept: '*/*',
				'accept-language': '*',
				cookie: this.credentials.toString(),
			},
			method: 'GET',
		}).then((res) => {
			if (!res.ok) throw new ResponseError('failed to fetch info', res);
			return res.text();
		});

		const doc = new DOMParser().parseFromString(src, 'text/html');
		const metas = Array.from(doc.documentElement.getElementsByTagName('meta'));
		/** @type {any} */
		const info = Object.fromEntries(metaInfoNames.map((name) => [name, '']));
		for (const meta of metas) {
			const name = meta.getAttribute('name');
			if (metaInfoNames.includes(name)) {
				info[name] = meta.getAttribute('content');
			}
		}
		return info;
	}

	/**
	 * @returns {Promise<number>}
	 */
	async pageCount() {
		const src = await fetch(`https://a.digi4school.at/ebook/${this.id}/`, {
			headers: {
				cookie: this.credentials.toString(),
			},
		}).then((res) => {
			if (!res.ok) throw new ResponseError('failed to fetch page count', res);
			return res.text();
		});

		return parseInt(src.match(/IDRViewer.makeNavBar\((\d+)/)[1]);
	}

	/**
	 * @param {number} nr
	 * @returns {Promise<string>} Page content
	 */
	async page(nr) {
		const content = await retryAsync(this.options.retryPage, async () => {
			return fetch(`https://a.digi4school.at/ebook/${this.id}/${nr}/${nr}.svg`, {
				headers: {
					accept: '*/*',
					'accept-language': '*',
					cookie: this.credentials.toString(),
				},
				method: 'GET',
			})
				.then((res) => {
					if (!res.ok) throw new ResponseError('failed to fetch page', res);
					return res.text();
				})
				.catch((e) => {
					if (e instanceof FetchError) return;
					else throw e;
				});
		});
		return content || '';
	}

	/**
	 * @param {Range[]} ranges
	 */
	async resolveRanges(ranges) {
		const pageCount = await this.pageCount();

		const pages = ranges
			.reduce((pages, { from, to }, index) => {
				if (isNaN(from) && index !== 0) {
					throw new Error(`Range ${index + 1} has invalid from`);
				}
				if (isNaN(to) && index != ranges.length - 1) {
					throw new Error(`Range ${index + 1} has invalid to`);
				}
				from = isNaN(from) ? 1 : from;
				to = isNaN(to) ? pageCount : to;

				[...Array(to - from + 1)].forEach((_, i) => pages.add(Math.min(pageCount, from + i)));
				return pages;
			}, new Set())
			.values();

		return [...pages];
	}

	/**
	 *
	 * @param {number} pageNr
	 * @param {string} path
	 * @returns {Promise<Buffer>}
	 */
	async image(pageNr, path) {
		const href = new URL(path, `${this.url}${pageNr}/`).href;

		return retryAsync(this.options.retryImage, () => {
			return fetch(href, {
				headers: {
					cookie: this.credentials.toString(),
				},
			})
				.then((res) => {
					if (!res.ok) throw new ResponseError('failed to download image', res);
					return res.buffer();
				})
				.catch((e) => {
					if (e instanceof FetchError) return;
					else throw e;
				});
		});
	}
}
