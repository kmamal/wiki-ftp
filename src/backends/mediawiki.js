
class MediaWikiBackend {
	constructor () {
		this._url = null
		this._username = null
		this._password = null
		this._cookies = new Map()
	}

	async open ({ url, username, password }) {
		this._url = url
		this._username = username
		this._password = password

		const tokenResponse = await fetch(`${this._url}?format=json&action=query&meta=tokens&type=login`)
		if (!tokenResponse.ok) {
			throw Object.assign(new Error("token query failed"), {
				statusCode: tokenResponse.status,
			})
		}
		for (const [ headerName, headerValue ] of tokenResponse.headers.entries()) {
			if (headerName !== 'set-cookie') { continue }
			const [ cookieName, cookieValue ] = headerValue.slice(0, headerValue.indexOf(';')).split('=')
			this._cookies.set(cookieName, cookieValue)
		}
		const tokenResult = await tokenResponse.json()
		const token = tokenResult.query.tokens.logintoken

		const form = new FormData()
		form.set('format', 'json')
		form.set('action', 'login')
		form.set('lgname', this._username)
		form.set('lgpassword', this._password)
		form.set('lgtoken', token)

		const loginResponse = await fetch(this._url, {
			method: 'POST',
			credentials: 'include',
			headers: {
				Cookie: [ ...this._cookies.entries() ]
					.map(([ k, v ]) => `${k}=${v}`)
					.join('; '),
			},
			body: form,
		})
		if (!loginResponse.ok) {
			throw Object.assign(new Error("login request failed"), {
				statusCode: loginResponse.status,
			})
		}
		for (const [ headerName, headerValue ] of tokenResponse.headers.entries()) {
			if (headerName !== 'set-cookie') { continue }
			const [ cookieName, cookieValue ] = headerValue.slice(0, headerValue.indexOf(';')).split('=')
			this._cookies.set(cookieName, cookieValue)
		}
		const loginResult = await loginResponse.json()

		if (loginResult.login.result !== 'Success') {
			throw Object.assign(new Error("login failed"), {
				reason: loginResult.login.reason,
			})
		}
	}

	close () {
		this._url = null
		this._username = null
		this._password = null
		this._cookies.clear()
	}

	async keys (prefix = '') {
		const queryResponse = await fetch(`${this._url}?format=json&action=query&list=allpages&apprefix=${prefix}`, {
			credentials: 'include',
			headers: {
				Cookie: [ ...this._cookies.entries() ]
					.map(([ k, v ]) => `${k}=${v}`)
					.join('; '),
			},
		})
		if (!queryResponse.ok) {
			throw Object.assign(new Error("allpages query failed"), {
				statusCode: queryResponse.status,
			})
		}
		const queryResult = await queryResponse.json()
		const pages = queryResult.query.allpages
		return pages.map((page) => page.title)
	}

	async get (key) {
		const contentResponse = await fetch(`${this._url}?format=json&action=query&prop=revisions&rvslots=*&rvprop=content|timestamp&titles=${key}`, {
			credentials: 'include',
			headers: {
				Cookie: [ ...this._cookies.entries() ]
					.map(([ k, v ]) => `${k}=${v}`)
					.join('; '),
			},
		})
		if (!contentResponse.ok) {
			throw Object.assign(new Error("content fetch failed"), {
				statusCode: contentResponse.status,
			})
		}

		const contentResult = await contentResponse.json()
		const revision = Object.values(contentResult.query.pages)[0].revisions[0]
		const content = revision.slots.main['*']
		const timestamp = new Date(revision.timestamp).getTime()

		return {
			value: content,
			modified: timestamp,
		}
	}

	async set (key, value) {
		const tokenResponse = await fetch(`${this._url}?format=json&action=query&meta=tokens`, {
			credentials: 'include',
			headers: {
				Cookie: [ ...this._cookies.entries() ]
					.map(([ k, v ]) => `${k}=${v}`)
					.join('; '),
			},
		})
		if (!tokenResponse.ok) {
			throw Object.assign(new Error("token query failed"), {
				statusCode: tokenResponse.status,
			})
		}
		const tokenResult = await tokenResponse.json()
		const token = tokenResult.query.tokens.csrftoken

		if (value === null) {
			const form = new FormData()
			form.set('format', 'json')
			form.set('action', 'delete')
			form.set('title', key)
			form.set('token', token)

			const deleteResponse = await fetch(this._url, {
				method: 'POST',
				credentials: 'include',
				headers: {
					Cookie: [ ...this._cookies.entries() ]
						.map(([ k, v ]) => `${k}=${v}`)
						.join('; '),
				},
				body: form,
			})
			if (!deleteResponse.ok) {
				throw Object.assign(new Error("delete request failed"), {
					statusCode: deleteResponse.status,
				})
			}
		} else {
			const form = new FormData()
			form.set('format', 'json')
			form.set('action', 'edit')
			form.set('title', key)
			form.set('text', value)
			form.set('token', token)

			const editResponse = await fetch(this._url, {
				method: 'POST',
				credentials: 'include',
				headers: {
					Cookie: [ ...this._cookies.entries() ]
						.map(([ k, v ]) => `${k}=${v}`)
						.join('; '),
				},
				body: form,
			})
			if (!editResponse.ok) {
				throw Object.assign(new Error("edit request failed"), {
					statusCode: editResponse.status,
				})
			}
		}
	}
}

module.exports = { MediaWikiBackend }
