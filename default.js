'use strict';

const
  _       = require('lodash'),
  express = require('express'),
  app     = express(),
  server  = require('http').createServer(app),
  mqtt    = require('mqtt'),
  io      = require('socket.io')(server),
  redis = require("redis")

// set vars from env
const
  mqttServer  = process.env.MQTT_SERVER,
  mqttTopic   = process.env.MQTT_TOPIC,
  redisUrl    = process.env.REDIS_URL,
  dashboardPort = process.env.PORT,
  devices     = _.fromPairs(_.map(_.split(process.env.DEVICES, ','), pair => {
    return _.split(pair, '=')
  })),
  republish   = !(process.env.DRY_RUN == 1)

// set up connections
const
  mqttClient  = mqtt.connect(mqttServer),
  redisClient = redis.createClient(redisUrl)

const handlers = {
  default: [
    (channel, room, message, topic) => {
      // Store raw data in redis and log it
      if (republish) {
        redisClient.rpush(topic, message)
      }
    },
  ],
  sensors: [
    // re-broadcast sensor data on a per-reading-type channel
    (channel, room, message, topic, id) => {
      const timestamp = (new Date()).getTime()
      const data = JSON.parse(message)

      let deviceId
      if (data.apiVersion == "2.0.0") {
        deviceId = data.device.id
      } else {
        deviceId = data.device
      }

      if (id !== deviceId) {
        console.error('device ID and published topic do not match!')
        return
      }

      if (data.lightlevel != null) {
        publishToMqtt(channel, 'lightlevel', {
          type: 'float',
          kind: 'lightlevel',
          value: data.lightlevel,
          device: deviceId,
          timestamp: timestamp
        })
      }

      publishToMqtt(channel, 'temperature', {
        type: 'float',
        kind: 'temperature',
        value: data.temperature,
        device: deviceId,
        timestamp: timestamp
      })

      publishToMqtt(channel, 'humidity', {
        type: 'float',
        kind: 'humidity',
        value: data.humidity,
        device: deviceId,
        timestamp: timestamp
      })
    }
  ],
  temperature: [
    (channel, room, message) => {
      const readings = []

      return (channel, room, message) => {
        const data = JSON.parse(message)
        readings.push(data.value)

        if (readings.length > 10) {
          readings.unshift()
        }
        console.log(readings)

        if (_.mean(readings) > 67.0) {
          return
        }

        publishToMqtt(channel, 'furnace', {
          type: 'bool',
          kind: 'action',
          value: true,
          device: 'furnace1',
          timestamp: (new Date()).getTime()
        }, 'furnace1')
      }
    }
  ]
}

const publishToMqtt = (channel, room, data, ...suffixes) => {
  const topic = _.join(_.flatten([channel, room, suffixes]), '/')

  if (republish) {
    return mqttClient.publish(topic, JSON.stringify(data))
  } else {
    return
  }
}

redisClient.on("error", (err) => {
  console.log("Error " + err)
})

app.use(express.static(__dirname))

mqttClient.on('connect', () => {
  mqttClient.subscribe(mqttTopic),
  mqttClient.publish("Wxec0cXgwgC9KwBK", "node app connected")
})

app.get('/', (req, res) => {
  res.render('./index.html')
})

app.get('/data/:room/:deviceId', (req, res) => {
  redisClient.lrange('Wxec0cXgwgC9KwBK/'+req.params.room, -1000, -1, (err, results) => {
    const data = _.map(_.filter(results, result => {
      return JSON.parse(result).device == req.params.deviceId
    }), result => {
      const obj = JSON.parse(result)

      return {
        x: obj.timestamp,
        y: obj.value
      }
    })

    res.status(200).send(JSON.stringify(data))
  })
})

mqttClient.on('message', (topic, message) => {
  // message is Buffer

  const [channel, room, ...rest]  = _.split(topic, '/')

  _.forEach(_.get(handlers, 'default', []), (handler) => {
    handler(channel, room, message.toString(), topic, ...rest)
  })
  _.forEach(_.get(handlers, room, []), (handler) => {
    handler(channel, room, message.toString(), topic, ...rest)
  })
})

io.on('connection', function (socket) {
  console.log('socket.io connection open')

  if (handlers.temperature == null) {
    _.set(handlers, 'temperature', [])
  }

  if (handlers.humidity == null) {
    _.set(handlers, 'humidity', [])
  }

  if (handlers.events == null) {
    _.set(handlers, 'events', [])
  }

  if (handlers.lightlevel == null) {
    _.set(handlers, 'lightlevel', [])
  }

  handlers.lightlevel.push((channel, room, message) => {
    const data = JSON.parse(message)
    socket.emit('updateChart', _.merge(data, {
      device_name: _.get(devices, data.device, 'unknown')
    }))
  })

  handlers.temperature.push((channel, room, message) => {
    const data = JSON.parse(message)
    socket.emit('updateChart', _.merge(data, {
      device_name: _.get(devices, data.device, 'unknown')
    }))
  })

  handlers.humidity.push((channel, room, message) => {
    const data = JSON.parse(message)
    socket.emit('updateChart', _.merge(data, {
      device_name: _.get(devices, data.device, 'unknown')
    }))
  })

  handlers.events.push((channel, room, message) => {
    console.log('adding motion event')
    const data = JSON.parse(message)
    socket.emit('addEvent', _.merge(data, {
      device: {
        name: _.get(devices, data.device, 'unknown')
      }
    }))
  })
});

server.listen(dashboardPort)

