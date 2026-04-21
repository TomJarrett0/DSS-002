const {Client} = require('pg')

const client = new Client({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres',
  password: 'DsSCouRSeW0rk2!',
  port: 5432,
})

client.connect()
.then(() => {console.log('Connected to PostgreSQL')})
.catch(()=>{console.log ('Failed to connect to PostgreSQL')})

module.exports = {client}