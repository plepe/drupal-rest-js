const queryString = require('qs')

const entityConfiguration = {
  node: {
    prefix: 'node',
    idField: 'nid'
  },
  taxonomy: {
    prefix: 'taxonomy/term',
    idField: 'tid'
  }
}

module.exports = class DrupalREST {
  constructor (options) {
    this.options = options
    this.sessionHeaders = {}
  }

  login (callback) {
    fetch(this.options.url + '/user/login?_format=json', {
      method: 'POST',
      header: {
	'Content-Type': 'application/json',
      },
      body: JSON.stringify({
	name: this.options.user,
	pass: this.options.pass,
      })
    })
      .then(req => {
	if (req.headers.has('Set-Cookie')) {
	  const cookie = req.headers.get('Set-Cookie').split(/;/g)[0]
	  this.sessionHeaders['Cookie'] = cookie
	}
	return req.json()
      })
      .then(data => {
	this.sessionHeaders['X-CSRF-Token'] = data.csrf_token
	callback(null)
      })
  }

  entityGet (entityType, id, options, callback) {
    const def = entityConfiguration[entityType]

    fetch(this.options.url + '/' + def.prefix + '/' + id + '?_format=json', {
      headers: this.sessionHeaders
    })
      .then(req => req.json())
      .then(data => callback(null, data))
  }

  entitySave (entityType, id, content, options, callback) {
    const def = entityConfiguration[entityType]

    fetch(this.options.url + '/' + def.prefix + (id ? '/' + id : '') + '?_format=json', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(content),
      headers: {
	'Content-Type': 'application/json',
	...this.sessionHeaders
      }
    })
      .then(req => req.json())
      .then(data => callback(null, data))
  }

  nodeGet (id, options, callback) {
    this.entityGet('node', id, options, callback)
  }

  nodeSave (id, content, options, callback) {
    this.entitySave('node', id, content, options, callback)
  }
}
