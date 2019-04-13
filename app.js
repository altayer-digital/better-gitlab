const _ = require('lodash');
const axios = require('axios');
const bluebird = require('bluebird');
const { parse } = require('url');
const next = require('next');
const express = require('express');
const expressSession = require('express-session');
const RedisStore = require('connect-redis')(expressSession);
require('express-async-errors');
const bodyParser = require('body-parser');
const qs = require('qs');

const {
  port,
  redisSessionStore,
  gitlabProjectId,
  gitlabBaseURL,
  gitlabAccessToken,
  gitlabUsername,
  JIRAWebBaseURL,
  JIRAAPIBaseURL,
  JIRAUser,
  JIRAAPIToken,
} = require('./config');

const JIRABasicAuthToken = Buffer.from(`${JIRAUser}:${JIRAAPIToken}`).toString('base64');
const JIRAClient = axios.create({
  paramsSerializer: params => qs.stringify(params, { arrayFormat: 'brackets' }),
  baseURL: JIRAAPIBaseURL,
  headers: {
    Authorization: `Basic ${JIRABasicAuthToken}`,
  },
});

const gitlabClient = axios.create({
  baseURL: gitlabBaseURL,
  headers: {
    'Private-Token': gitlabAccessToken,
  },
});

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true,
}));

app.use(expressSession({
  cookie: {
    httpOnly: true,
    maxAge: 86400,
  },
  resave: false,
  saveUninitialized: true,
  secret: 'secret',
  store: new RedisStore(redisSessionStore),
}));

const fromAuthor = ({
  id,
  name,
  username,
  state,
  avatar_url: avatarUrl,
  web_url: authorUrl,
}) => ({
  authorId: id,
  name,
  username,
  state,
  avatarUrl,
  authorUrl,
});

app.get('/mrs', async (req, res) => {
  const { data: mrs } = await gitlabClient.get(`/projects/${gitlabProjectId}/merge_requests?state=opened&per_page=100&page=1`);

  const JIRAIssueKeyRegExp = /(OWEB|ONOS|ONA)\-\d+/g;

  const mrsFormatted = mrs
    .filter(({
      source_project_id,
      target_project_id,
    }) => source_project_id === gitlabProjectId
      && target_project_id === gitlabProjectId)
    .map(({
      iid: mrId,
      web_url: gitlabUrl,
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      author,
      upvotes: upVotes,
      downvotes: downVotes,
      created_at: createdAt,
      updated_at: updatedAt,
      user_notes_count: numberOfComments,
    }) => ({
      mrId,
      JIRATicketId: (
        title.match(JIRAIssueKeyRegExp)
        || sourceBranch.match(JIRAIssueKeyRegExp)
        || [])[0],
      gitlabUrl,
      sourceBranch,
      targetBranch,
      title,
      author: fromAuthor(author),
      upVotes,
      downVotes,
      createdAt,
      updatedAt,
      numberOfComments,
    }));

  res.json(mrsFormatted);
});

app.get('/votes', async (req, res) => {
  const mrIdUpVoteAuthorsPairs = await bluebird.map(req.query.mrs, async (mrId) => {
    const { data: authors } = await gitlabClient.get(`/projects/${gitlabProjectId}/merge_requests/${mrId}/award_emoji`);
    const mrUpVoteAuthors = authors.map(({
      user,
    }) => ({
      mrId,
      ...fromAuthor(user),
    }));
    return [mrId, {
      upVoteAuthors: mrUpVoteAuthors,
      upVotedByMe: !!mrUpVoteAuthors.find(({ username }) => username === gitlabUsername),
    }];
  }, { concurrency: 5 });

  res.header('Cache-Control', 'max-age=86400');
  res.json(_.fromPairs(mrIdUpVoteAuthorsPairs));
});

app.get('/changes', async (req, res) => {
  const pairs = await bluebird.map(req.query.mrs, async (mrId) => {
    const {
      data,
    } = await gitlabClient.get(`/projects/${gitlabProjectId}/merge_requests/${mrId}/changes`);

    const { changes, changes_count: filesChanged } = data;

    const [linesAdded, linesRemoved] = _.chain(changes)
      .flatMap(({ diff }) => diff
        .split('\n')
        .map(line => ['+', '-'].map(operator => line.startsWith(operator))))
      .reduce(([totalAdded, totalRemoved], [added, removed]) => [
        totalAdded + added,
        totalRemoved + removed,
      ], [0, 0])
      .value();

    return [mrId, {
      filesChanged: parseInt(filesChanged, 10),
      linesAdded,
      linesRemoved,
    }];
  }, { concurrency: 5 });

  res.header('Cache-Control', 'max-age=86400');
  res.json(_.fromPairs(pairs));
});

app.get('/comments', async (req, res) => {
  const unresolvedDiscussions = await bluebird.map(req.query.mrs, async (mrId) => {
    const {
      data,
    } = await gitlabClient.get(`/projects/${gitlabProjectId}/merge_requests/${mrId}/notes`);

    const hasUnresolvedDiscussions = !!data.find(({
      author: { username },
      resolvable,
      resolved,
    }) => resolvable && !resolved && username === gitlabUsername);

    return [mrId, {
      commentAuthors: _(data)
        .filter(({ resolvable, resolved }) => resolvable && !resolved)
        .map(({ author }) => fromAuthor(author))
        .uniqBy('username')
        .value(),
      hasUnresolvedDiscussions,
    }];
  });

  res.header('Cache-Control', 'max-age=86400');
  res.json(_.fromPairs(unresolvedDiscussions));
});

app.get('/issues', async (req, res) => {
  const issueKeys = req.query.mrs.join('\',\'');

  const { data: { issues } } = await JIRAClient.get('/search', {
    params: {
      jql: `key in ('${issueKeys}')`,
      fields: 'priority,summary,status,issuetype,created,assignee,reporter,timespent',
    },
  });

  const byJIRATicketId = _(issues)
    .map(({
      key: JIRATicketId,
      fields: {
        summary,
        reporter,
        assignee,
        issuetype: issueType,
        status: {
          name: status,
        },
        priority,
        timespent: timeSpent,
        created: createdAt,
      },
    }) => ({
      JIRATicketId,
      webUrl: `${JIRAWebBaseURL}/browse/${JIRATicketId}`,
      reporter,
      assignee,
      summary,
      issueType,
      status,
      priority,
      timeSpent,
      createdAt,
    }))
    .groupBy('JIRATicketId')
    .mapValues(([issue]) => issue)
    .value();

  res.header('Cache-Control', 'max-age=86400');
  res.json(byJIRATicketId);
});

const nextApp = next({ dev: process.env.NODE_ENV !== 'production' });
const nextRequestHandler = nextApp.getRequestHandler();

app.use((req, res) => {
  nextRequestHandler(req, res, parse(req.url, true));
});

nextApp.prepare().then(() => {
  app.listen(port, (err) => {
    if (err) {
      throw err;
    }

    console.log('> ready on', port);
  });
});
