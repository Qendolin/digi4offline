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
	 * Searches for book in user's bookshelf
	 * @private
	 * @param {string} bookId
	 * @returns {Promise<URLSearchParams>} Bookshelf LTI request
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
	 * Parse LTI request from form body
	 * @private
	 * @param {string} src
	 * @returns {URLSearchParams} Bookshelf LTI request
	 */
	_parseLtiResponse(src) {
		const doc = this.#domParser.parseFromString(src, 'text/html');
		const form = doc.getElementsByTagName('form')[0];

		const params = new URLSearchParams();
		Array.from(form.getElementsByTagName('input')).forEach((input) => {
			params.set(input.getAttribute('name'), input.getAttribute('value'));
		});
		return params;
	}

	/**
	 * @private
	 * @param {URLSearchParams} params
	 * @returns {Promise<URLSearchParams>} Calatog LTI request
	 */
	async _ltiShelf(params) {
		const src = await fetch('https://kat.digi4school.at/lti', {
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
	 * @param {URLSearchParams} params
	 */
	async _ltiCatalog(params) {
		return fetch('https://a.digi4school.at/lti', {
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
			this.#cookies.set(...res.headers.raw()['set-cookie']);
		});
	}

	/**
	 * Aquires book lock
	 * @param {string} bookId
	 * @returns {Promise<Book>}
	 */
	async aquireBook(bookId) {
		if (!this.#authenticated) throw new Error('Not authenticated');

		const shelfRequest = await this._findBookInShelf(bookId);
		const catRequets = await this._ltiShelf(shelfRequest);
		await this._ltiCatalog(catRequets);
		return new Book(bookId, Cookies.parse(this.#cookies.toString()));
	}

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
