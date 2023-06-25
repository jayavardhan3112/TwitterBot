const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const prompts = require("./prompts");
const wildcards = require("./wildcards");
const genericPrompts = require("./genericPrompts");
const { CLIENT_ID, CLIENT_SECRET, OPEN_AI_API_KEY } = require("./secrets");

// Database reference
const dbRef = admin.firestore().doc("tokens/demo");

// Twitter API init
const TwitterApi = require("twitter-api-v2").default;
const twitterClient = new TwitterApi({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
});
const callbackURL =
  "http://localhost:5000/twitter-bot-f7d3b/us-central1/callback";

// OpenAI API init
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  apiKey: OPEN_AI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// STEP 1 - Auth URL
exports.auth = functions.https.onRequest(async (request, response) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
    callbackURL,
    { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
  );

  // store verifier
  await dbRef.set({ codeVerifier, state });

  response.redirect(url);
});

// STEP 2 - Verify callback code, store access_token
exports.callback = functions.https.onRequest(async (request, response) => {
  const { state, code } = request.query;

  const dbSnapshot = await dbRef.get();
  const { codeVerifier, state: storedState } = dbSnapshot.data();

  console.log(state, storedState);
  if (state !== storedState) {
    return response.status(400).send("Stored tokens do not match!");
  }

  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callbackURL,
  });

  await dbRef.set({ accessToken, refreshToken });

  const { data } = await loggedClient.v2.me(); // start using the client if you want

  response.send(data);
});

// STEP 3 - Refresh tokens and post tweets
exports.tweet = functions.https.onRequest(async (request, response) => {
  const allPrompts = [...prompts, ...genericPrompts];
  // const selectedPrompt =
  //   allPrompts[Math.floor(Math.random() * allPrompts.length)];
  // const selectedWildcard =
  //   wildcards[Math.floor(Math.random() * wildcards.length)];
  // const codeHumorTweet =
  //   "Training on a diverse collection of hilarious coding puns, relatable tech tweets, and memorable coding anecdotes. Let's generate a tweet that captures the essence of the tech community's wit, experiences, and camaraderie. Share your favorite coding joke, drop a tech-related emoji, or tell us about a coding moment that made you laugh or facepalm! Whether it's debugging nightmares, coding triumphs, funny tech encounters, or anything that tickles your developer sense of humor, let's create a tweet that resonates with developers worldwide. Together, we can bring a smile to the faces of fellow coders and celebrate the unique blend of creativity and nerdiness that defines our community. ";
  // const codePunsTweet =
  //   "Training on a collection of hilarious coding puns, relatable tech tweets, memorable coding anecdotes, and random wildcards to spice up tech tweets. Let's generate a tweet that captures the essence of the tech community's wit, experiences, and engagement. Share your best coding joke, epic coding fail, or drop a tech-related emoji to join the fun! Together, let's create a tweet that resonates with developers worldwide";

  const randomWildcard =
    wildcards[Math.floor(Math.random() * wildcards.length)];

  const filteredPrompts = allPrompts.filter((prompt) =>
    prompt.includes(randomWildcard)
  );

  const randomPrompt =
    filteredPrompts[Math.floor(Math.random() * filteredPrompts.length)];

  const tweetPrompt = randomPrompt.replace(/\[Wildcard\]/g, randomWildcard);

  const combinedText = tweetPrompt;
  // const infoTweet = selectedPrompt + ", " + selectedWildcard;
  // const finalData = [codePunsTweet, infoTweet];
  // const combinedText = finalData[Math.floor(Math.random() * finalData.length)];

  const { refreshToken } = (await dbRef.get()).data();

  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);

  await dbRef.set({ accessToken, refreshToken: newRefreshToken });

  const nextTweet = await openai.createCompletion("text-davinci-003", {
    prompt: combinedText,
    max_tokens: 64,
  });

  const { data } = await refreshedClient.v2.tweet(
    nextTweet.data.choices[0].text
  );

  response.send(data);
});

exports.tweetHourly = functions.pubsub
  .schedule("0 * * * *")
  .onRun(async (context) => {
    console.log(context);
  });
