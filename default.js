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
  }))

// set up connections
const
  mqttClient  = mqtt.connect(mqttServer),
  redisClient = redis.createClient(redisUrl)

const handlers = {
  default: [
    (channel, room, message, topic) => {
      // Store raw data in redis and log it
      redisClient.rpush(topic, message)
    },
  ],
  sensors: [
    // re-broadcast sensor data on a per-reading-type channel
    (channel, room, message, topic, id) => {
      const timestamp = (new Date()).getTime()
      const data = JSON.parse(message)

      if (id !== data.device) {
        console.error('device ID and published topic do not match')
        return
      }

      publishToMqtt(channel, 'temperature', {
        type: 'float',
        kind: 'temperature',
        value: data.temperature,
        device: data.device,
        timestamp: timestamp
      })

      publishToMqtt(channel, 'humidity', {
        type: 'float',
        kind: 'humidity',
        value: data.humidity,
        device: data.device,
        timestamp: timestamp
      })
    }
  ]
}

const publishToMqtt = (channel, room, data, ...suffixes) => {
  const topic = _.join(_.flatten([channel, room, suffixes]), '/')

  return mqttClient.publish(topic, JSON.stringify(data))
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
});

server.listen(dashboardPort)

