const Stream = require('stream')
const Path = require('path')

class WikiFs {
	constructor (impl) {
		this._impl = impl
		this._cwd = '/'
	}

	currentDirectory () {
		return this._cwd
	}

	chdir (path = '.') {
		const key = this._toKey(path)
		const clientPath = `/${key}`
		this._cwd = clientPath
		return this.currentDirectory()
	}

	async list (path = '.') {
		const _prefix = this._toKey(path)
		const prefix = _prefix ? `${_prefix}/` : ''
		const keys = await this._impl.keys(prefix)
		const grouped = Object.groupBy(keys, (key) => {
			const end = key.indexOf('/', prefix.length)
			return key.slice(0, end === -1 ? undefined : end)
		})
		const stats = await Promise.all(Object.entries(grouped).map(([ key, values ]) => this._stat(key, values)))
		return stats.filter(Boolean)
	}

	async get (fileName) {
		const key = this._toKey(fileName)
		const stats = await this._stat(key)
		if (!stats) { throw new Error("not found") }
		return stats
	}

	async read (fileName, options = {}) {
		const { start } = options
		const key = this._toKey(fileName)
		const entry = await this._impl.get(key)
		if (!entry) { throw new Error("not found") }
		const data = entry.value.slice(start)
		const stream = Stream.Readable.from(data)
		const clientPath = `/${key}`

		return {
			stream,
			clientPath,
		}
	}

	async write (fileName, options = {}) {
		const {
			append = false,
			start = undefined,
		} = options
		const key = this._toKey(fileName)

		const chunks = []
		if (append || start) {
			const entry = await this._impl.get(key)
			if (!entry) { throw new Error("not found") }
			const chunk = append ? entry.value : entry.value.slice(start)
			chunks.push(chunk)
		}

		const stream = new Stream.PassThrough()
		stream
			.on('data', (chunk) => {
				chunks.push(chunk)
			})
			.on('end', async () => {
				const data = Buffer.concat(chunks)
				await this._impl.set(key, data)
			})

		const clientPath = `/${key}`

		return {
			stream,
			clientPath,
		}
	}

	async rename (from, to) {
		const fromPrefix = this._toKey(from)
		const toPrefix = this._toKey(to)

		const fromKeys = await this._impl.keys(fromPrefix)
		await Promise.all(fromKeys.map(async (fromKey) => {
			const entry = await this._impl.get(fromKey)
			if (!entry) { throw new Error("not found") }
			const toKey = fromKey.replace(fromPrefix, toPrefix)
			return Promise.all([
				this._impl.set(fromKey, null),
				this._impl.set(toKey, entry.value),
			])
		}))
	}

	async delete (path) {
		const prefix = this._toKey(path)
		const keys = await this._impl.keys(prefix)
		await Promise.all(keys.map((key) => this._impl.set(key, null)))
	}

	mkdir () {}

	chmod () {}

	_toKey (path) {
		return Path.resolve(this._cwd, path).slice(1)
	}

	async _stat (prefix, _keys) {
		const keys = _keys ?? await this._impl.keys(prefix)

		if (keys.length === 1 && keys[0] === prefix) {
			return this._fileStat(prefix)
		}

		return this._dirStat(prefix)
	}

	async _fileStat (key) {
		const entry = await this._impl.get(key)
		if (entry.value === null) { return null }

		return {
			name: key.split('/').pop(),
			size: entry.value ? entry.value.length : 0,
			isDirectory: () => false,
			mtime: entry.modified,
		}
	}

	_dirStat (prefix) {
		const name = prefix.split('/').pop() || '/'
		return {
			name,
			size: 0,
			isDirectory: () => true,
			mtime: Date.now(),
		}
	}
}

module.exports = { WikiFs }
