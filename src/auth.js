import { DOMParser } from 'xmldom';
import fetch from 'node-fetch';
import { Book } from './book.js';
import { ResponseError } from './util.js';

export class Cookies {
	#cookies = new Map();

	/**
	 * @param {string} header a Cookie: header
	 * @returns {Cookies}
	 */
	static parse(header) {
		const cookies = new Cookies();
		header = header.replace(/^Cookie: /gi, '');
		cookies.set(...header.split('; '));
		return cookies;
	}

	/**
	 * @param  {...string} headerValues
	 */
	set(...headerValues) {
		headerValues.forEach((value) => {
			const [k, v] = value.split(';', 1)[0].split('=', 2);
			this.#cookies.set(k, v);
		});
	}

	/**
	 * @param  {string} headerValue
	 */
	delete(headerValue) {
		const [k] = headerValue.split(';', 1)[0].split('=', 2);
		this.#cookies.delete(k);
	}

	toString() {
		return [...this.#cookies.entries()].map((e) => `${e[0]}=${e[1]}`).join('; ');
	}
}

export class User {
	/** @type {Cookies} */
	#cookies;
	#authenticated = false;
	#domParser = new DOMParser();

	/**
	 * Searches for book in user's bookshelf, only works for books hosted on digi4school directly
	 * @private
	 * @param {string} bookId
	 * @returns {Promise<[string, URLSearchParams]>} Bookshelf LTI request
	 */
	async _findBookInShelf(bookId) {
		const src = await fetch(`https://digi4school.at/br/find/${bookId}/`, {
			headers: {
				cookie: this.#cookies.toString(),
			},
		}).then((res) => {
			if (res.status != 200) throw new ResponseError('failed to find book in bookshelf', res);
			return res.text();
		});

		return this._parseLtiResponse(src);
	}

	/**
	 * Searches for book in user's bookshelf
	 * @private
	 * @param {string} bookUrl a direct url like https://digi4school.at/ebook/10q594mvaytx
	 * @returns {Promise<[string, URLSearchParams]>} Bookshelf LTI request
	 */
	async _openBookFromShelf(bookUrl) {
		const src = await fetch(bookUrl, {
			headers: {
				cookie: this.#cookies.toString(),
			},
		}).then((res) => {
			if (res.status != 200) throw new ResponseError('failed open book in shelf', res);
			return res.text();
		});

		return this._parseLtiResponse(src);
	}

	/**
	 * Parse LTI request from form body
	 * @private
	 * @param {string} src
	 * @returns {[string, URLSearchParams]} Bookshelf LTI request
	 */
	_parseLtiResponse(src) {
		const doc = this.#domParser.parseFromString(src, 'text/html');
		const form = doc.getElementsByTagName('form')[0];

		const params = new URLSearchParams();
		Array.from(form.getElementsByTagName('input')).forEach((input) => {
			params.set(input.getAttribute('name'), input.getAttribute('value'));
		});
		return [form.getAttribute('action'), params];
	}

	/**
	 * @private
	 * @param {string} url
	 * @param {URLSearchParams} params
	 * @returns {Promise<[string, URLSearchParams]>} Catalog LTI request
	 */
	async _ltiShelf(url, params) {
		const src = await fetch(url, {
			method: 'POST',
			body: params.toString(),
			headers: {
				accept: '*/*',
				'accept-language': '*',
				cookie: this.#cookies.toString(),
				'content-type': 'application/x-www-form-urlencoded',
			},
			redirect: 'manual',
		}).then((res) => {
			if (res.status != 200) throw new ResponseError('lti failed', res);
			this.#cookies.set(...res.headers.raw()['set-cookie']);
			return res.text();
		});

		return this._parseLtiResponse(src);
	}

	/**
	 * @private
	 * @param {string} launchUrl
	 * @param {URLSearchParams} params
	 * @returns {Promise<URL>} the content url
	 */
	async _ltiLaunchRequest(launchUrl, params) {
		return fetch(launchUrl, {
			method: 'POST',
			body: params.toString(),
			headers: {
				accept: '*/*',
				'accept-language': '*',
				cookie: this.#cookies.toString(),
				'content-type': 'application/x-www-form-urlencoded',
			},
			redirect: 'manual',
		}).then((res) => {
			if (res.status != 302) throw new ResponseError('lti failed', res);
			const location = res.headers.get('location');
			if (!!location.match(/^https?:\/\/digi4school\.at\/err/)) {
				throw new Error(`lti returned error url: ${location}`);
			}
			this.#cookies.set(...res.headers.raw()['set-cookie']);
			return new URL(location);
		});
	}

	/**
	 * Aquires book lock
	 * @param {string} linkIdOrUrl
	 * @returns {Promise<Book>}
	 */
	async aquireBook(linkIdOrUrl) {
		if (!this.#authenticated) throw new Error('Not authenticated');

		let shelfUrl = null,
			shelfRequest = null;
		if (linkIdOrUrl.startsWith('http')) {
			[shelfUrl, shelfRequest] = await this._openBookFromShelf(linkIdOrUrl);
		} else {
			[shelfUrl, shelfRequest] = await this._findBookInShelf(linkIdOrUrl);
		}
		const [launchUrl, launchRequest] = await this._ltiShelf(shelfUrl, shelfRequest);
		const linkId = launchRequest.get('resource_link_id');
		const contentUrl = await this._ltiLaunchRequest(launchUrl, launchRequest);
		const book = new Book(linkId, contentUrl, Cookies.parse(this.#cookies.toString()));
		await book.initialize();
		return book;
	}

	_isUniqueBookId;

	/**
	 * @param {String} email
	 * @param {String} password
	 * @returns
	 */
	async authenticate(email, password) {
		this.#cookies = new Cookies();

		const res = await fetch('https://digi4school.at/br/xhr/login', {
			headers: {
				accept: '*/*',
				'accept-language': '*',
				'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
			},
			body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
			method: 'POST',
		});
		if (!res.ok) throw new ResponseError('authentication failed', res);

		switch (await res.text()) {
			case 'OK':
				console.log('Login successful');
				this.#authenticated = true;
				break;
			case 'KO':
				console.log('Login unsuccessful');
				process.exit(-1);
			default:
				this.#authenticated = true;
				console.warn(
					'Login returned unexpected response, the login data either was bad or this tool is out of date. Continuing...'
				);
		}
		this.#cookies.set(...res.headers.raw()['set-cookie']);
	}
}
