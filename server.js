
const PORT = process.env.PORT || 5000;

var express = require("express");
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var cors = require("cors");
var morgan = require("morgan");
var jwt = require('jsonwebtoken');
var http = require("http");
var socketIO = require('socket.io');
const path = require("path");
const mongoose = require("mongoose");
var bcrypt = require("bcrypt-inzi");
var postmark = require("postmark");
const axios = require('axios')
const fs = require('fs')
const multer = require('multer')
var server = http.createServer(app);

// var client = new postmark.Client("postmark token");

var {SERVER_SECRET} = require("./core/index")
var serviceAccount = json.parser(process.env.SERVICE_ACCOUNT)
var { userModel, tweetModel} = require("./dbrepo/models")
var authRoutes = require("./routes/auth");

/////////////////////////////FIREBASE UPLOAD PROFILE PIC//////////////////////////////

const storage = multer.diskStorage({ // https://www.npmjs.com/package/multer#diskstorage
    destination: './uploads/',
    filename: function (req, file, cb) {
        cb(null, `${new Date().getTime()}-${file.filename}.${file.mimetype.split("/")[1]}`)
    }
})
var upload = multer({ storage: storage })

const admin = require("firebase-admin");
// https://firebase.google.com/docs/storage/admin/start
var serviceAccount = SERVICE_ACCOUNT // create service account from here: https://console.firebase.google.com/u/0/project/delete-this-1329/settings/serviceaccounts/adminsdk
  
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://tweeter-chat-app-default-rtdb.firebaseio.com/"
});
const bucket = admin.storage().bucket("gs://tweeter-chat-app.appspot.com");

///////////////////////////////////////////////////////////////////////

var app = express();
var server = http.createServer(app);
app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors({
    origin: "*",
    credentials: true
}));
app.use(morgan('dev'));

app.use("/", express.static(path.resolve(path.join(__dirname, "public"))));
app.use('/', authRoutes)



var io = socketIO(server);
io.on("connection", (user) => {
    console.log("user connected");
})

app.use(function (req, res, next) {

    console.log("req.cookies: ", req.cookies);
    if (!req.cookies.jToken) {
        res.status(401).send("include http-only credentials with every request")
        return;
    }
    jwt.verify(req.cookies.jToken, SERVER_SECRET, function (err, decodedData) {
        if (!err) {

            const issueDate = decodedData.iat * 1000;
            const nowDate = new Date().getTime();
            const diff = nowDate - issueDate; 
        

            if (diff > 300000) { // expire after 5 min (in milis)
                res.status(401).send("token expired")
            } else { 
                var token = jwt.sign({
                    id: decodedData.id,
                    name: decodedData.name,
                    email: decodedData.email,
                    phone: decodedData.phone,
                    gender: decodedData.gender,
                }, SERVER_SECRET)
                res.cookie('jToken', token, {
                    maxAge: 86_400_000,
                    httpOnly: true
                });
                req.body.jToken = decodedData
                next();
            }
        } else {
            res.status(401).send("invalid token")
        }
    });
})

//PROFILE

app.get("/profile", (req, res, next) => {
    console.log(req.body);

    userModel.findById(req.body.jToken.id, 'name email phone gender profilePic createdOn', function (err, doc) {
        if (!err) {
            res.send({
                profile: doc
            })

        } else {
            res.send({
                message: "Server Error",
                status: 500
            });
        }
    });
})


//POST

app.post("/tweet", (req, res, next) => {
   

    if (!req.body.jToken.id || !req.body.tweet) {
        res.send({
            status: 401,
            message: "Please write tweet"
        })
    }
    userModel.findById(req.body.jToken.id, 'name', function (err, user) {
        if (!err) {
            tweetModel.create({
                "username": user.name,
                "tweet": req.body.tweet
            }, function (err, data) {
                if (err) {
                    res.send({
                        message: "Tweet DB ERROR",
                        status: 404
                    });
                }
                else if (data) {
                    console.log("data checking Tweeter ", data);
                    res.send({
                        message: "Your Tweet Send",
                        status: 200,
                        tweet: data
                    });
                    io.emit("NEW_POST", data);

                    console.log("server checking code tweet ", data.tweet)
                } else {
                    res.send({
                        message: "Tweets posting error try again later",
                        status: 500
                    });
                }
            });

        } else {
            res.send({
                message: "User Not Found",
                status: 404
            });
        }
    });


});

app.get("/tweet-get", (req, res, next) => {
    tweetModel.find({}, function (err, data) {
        if (err) {
            res.send({
                message: "Error :" + err,
                status: 404
            });
        } else if (data) {
            res.send({
                tweet: data,
                status: 200
            });
        } else {
            res.send({
                message: "User Not Found"
            });
        }
    });
});
//UpLOad//

app.post("/upload", upload.any(), (req, res, next) => {
    console.log("req.body: ", JSON.parse(req.body.myDetails));
    let userEmail = JSON.parse(req.body.myDetails)
    // console.log("req.email: ", req.body.myDetails);
    console.log("req.files: ", req.files);

    console.log("uploaded file name: ", req.files[0].originalname);
    console.log("file type: ", req.files[0].mimetype);
    console.log("file name in server folders: ", req.files[0].filename);
    console.log("file path in server folders: ", req.files[0].path);

    bucket.upload(
        req.files[0].path,
        // {
        //     destination: `${new Date().getTime()}-new-image.png`, // give destination name if you want to give a certain name to file in bucket, include date to make name unique otherwise it will replace previous file with the same name
        // },
        function (err, file, apiResponse) {
            if (!err) {
                // console.log("api resp: ", apiResponse);

                // https://googleapis.dev/nodejs/storage/latest/Bucket.html#getSignedUrl
                file
                    .getSignedUrl({
                        action: "read",
                        expires: "03-09-2491",
                    })
                    .then((urlData, err) => {
                        if (!err) {
                            console.log("public downloadable url: ", urlData[0]); // this is public downloadable url
                            userModel.findOne(
                                { email: userEmail.email },
                                (err, data) => {
                                    if (!err) {
                                        console.log("user data ====>", data);
                                        tweetModel.updateMany({ email: userEmail.email }, { profilePic: urlData[0] }, (err, tweet) => {
                                            if (!err) {
                                                console.log("tweet model updated");
                                            }
                                        })
                                    } else {
                                        console.log("user not found");
                                    }
                                    data.update(
                                        { profilePic: urlData[0] },

                                        (err, updatedUrl) => {
                                            if (!err) {
                                                res.status(200).send({
                                                    message: "profile picture updated succesfully",
                                                    url: urlData[0],
                                                });
                                            } else {
                                                res.status(500).send({
                                                    message: "an error occured",
                                                });
                                            }
                                        }
                                    );



                                }
                            );

                            // // delete file from folder before sending response back to client (optional but recommended)
                            // // optional because it is gonna delete automatically sooner or later
                            // // recommended because you may run out of space if you dont do so, and if your files are sensitive it is simply not safe in server folder
                            // try {
                            //     fs.unlinkSync(req.files[0].path)
                            //     //file removed
                            // } catch (err) {
                            //     console.error(err)
                            // }
                            // res.send({
                            //   message: "ok",
                            //   url: urlData[0],
                            // });
                        }
                    });
            } else {
                console.log("err: ", err);
                res.status(500).send();
            }
        }
    );
});
// app.post("/upload", upload.any(), (req, res, next) => {

//     console.log("req.body: ", req.body);
//     bucket.upload(
//         req.files[0].path,
//         function (err, file, apiResponse) {
//             if (!err) {
//                 file.getSignedUrl({
//                     action: 'read',
//                     expires: '03-09-2491'
//                 }).then((urlData, err) => {
//                     if (!err) {
//                         console.log("public downloadable url: ", urlData[0])
//                         userModel.findOne({ email: req.body.email }, (err, user) => {
//                             console.log(user)
//                             if (!err) {
//                                 tweetModel.updateMany({ name: req.headers.jToken.name }, {profilePic:urlData[0]}, (err, tweetModel) => {
//                                     console.log(tweetModel)
//                                     if (!err) {
//                                         console.log("update");
//                                     }
//                                 });
//                                 user.update({ profilePic: urlData[0] }, (err, updatedProfile) => {
//                                     if (!err) {
//                                         res.status(200).send({
//                                             message: "succesfully uploaded",
//                                             url: urlData[0],
//                                         })
//                                     }
//                                     else {
//                                         res.status(500).send({
//                                             message: "an error occured" + err,
//                                         })
//                                     }

//                                 })
//                             }
//                             else {
//                                 res.send({
//                                     message: "error"
//                                 });
//                             }
//                         })
//                         try {
//                             fs.unlinkSync(req.files[0].path)
//                         } catch (err) {
//                             console.error(err)
//                         }
//                     }
//                 })
//             } else {
//                 console.log("err: ", err)
//                 res.status(500).send();
//             }
//         });
// })

//SERVER

server.listen(PORT, () => {
    console.log("server is running on: ", PORT);
})
