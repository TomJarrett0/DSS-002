const express = require('express')
const app = express()
const {client} = require('./pg')


app.use (express.json())
app.use (express.urlencoded({extended: false}))
app.use('/user', require('./routes/user'))

app.get("/", (req, res) => 
    {res.send('Hello its backend')})

async function getdata(){
    const res= await client.query('SELECT * FROM;')
    console.log(res)
}

app.listen(3000, () => {
  console.log('Server is running on port 3000')
})

