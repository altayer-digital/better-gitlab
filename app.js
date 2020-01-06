const _ = require('lodash');
const axios = require('axios');
const bluebird = require('bluebird');
const { parse } = require('url');
const next = require('next');
const express = require('express');
const expressSession = require('express-session');
const RedisStore = require('connect-redis')(expressSession);
const cors = require('cors');
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
  togglAPIToken,
  togglBaseURL,
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

const basicAuthToken = Buffer.from(`${togglAPIToken}:api_token`).toString('base64');
const togglClient = axios.create({
  baseURL: togglBaseURL,
  headers: {
    Authorization: `Basic ${basicAuthToken}`,
  },
});

const app = express();

app.use(cors());

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

const JIRAIssueKeyRegExp = /[A-Z]{2,}\-\d+/g;

app.get('/projects', async (req, res) => {
  const { data: projects } = await gitlabClient.get('/projects?per_page=100&page=1');
  res.json(projects);
});

app.get('/mrs', async (req, res) => {
  const { data: mrs } = await gitlabClient.get(`/projects/${gitlabProjectId}/merge_requests?state=opened&per_page=100&page=1`);

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
      expand: 'changelog',
      fields: 'priority,summary,status,issuetype,created,assignee,reporter,timespent',
    },
  });

  const byJIRATicketId = _(issues)
    .map(({
      key,
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
      changelog,
    }) => {
      const movedKey = _(changelog.histories)
        .flatMap('items')
        .filter(['field', 'Key'])
        .map('fromString')
        .intersection(req.query.mrs)
        .head();

      return {
        JIRATicketId: movedKey || key,
        webUrl: `${JIRAWebBaseURL}/browse/${key}`,
        reporter,
        assignee,
        summary,
        issueType,
        status,
        priority,
        timeSpent,
        createdAt,
      };
    })
    .groupBy('JIRATicketId')
    .mapValues(([issue]) => issue)
    .value();

  res.header('Cache-Control', 'max-age=86400');
  res.json(byJIRATicketId);
});

app.get('/sync', async (req, res) => {
  const { data: diff } = await gitlabClient.get(`/projects/${gitlabProjectId}/repository/compare?from=master&to=beta`);
  const onBetaAsPerGit = _(diff.commits)
    .map(({ title }) => {
      const [JIRAIssueKey] = title.match(JIRAIssueKeyRegExp) || [];
      return JIRAIssueKey;
    })
    .filter(Boolean)
    .uniq()
    .value();

  const { data: { issues } } = await JIRAClient.get('/search', {
    params: {
      jql: 'labels = "beta"',
      fields: 'status',
      expand: 'changelog',
    },
  });
  const onBetaAsPerJIRA = issues.map(({ key, changelog }) => {
    const { fromString = '' } = _(changelog.histories)
      .flatMap('items')
      .find(['field', 'Key']) || {};

    return fromString || key;
  });

  const issueKeysToAddNextLabel = _.difference(onBetaAsPerGit, onBetaAsPerJIRA);
  const issueKeysToRemoveNextLabel = _.difference(onBetaAsPerJIRA, onBetaAsPerGit);

  await bluebird.map(issueKeysToAddNextLabel, async key => JIRAClient.put(`/issue/${key}`, {
    update: {
      labels: [
        { add: 'nis-beta' },
      ],
    },
  }), { concurrency: 5 });

  res.json({
    onBetaAsPerGit, onBetaAsPerJIRA, issueKeysToAddNextLabel, issueKeysToRemoveNextLabel,
  });
});

const stopRunningTimeEntry = async ({ description } = {}) => {
  const { data: { data: { id: timeEntryId } } } = await togglClient.get('/time_entries/current');
  if (description) {
    await togglClient.put(`/time_entries/${timeEntryId}`, {
      time_entry: {
        description,
      },
    });
  }
  const { data: timeEntry } = await togglClient.put(`/time_entries/${timeEntryId}/stop`);
  return timeEntry;
};

app.get('/startReview/:JIRATicketId', async (req, res) => {
  const { JIRATicketId } = req.params;
  const { data: clients } = await togglClient.get('/clients');
  const { id: clientId } = _.find(clients, ['name', 'AlTayer']);
  const { data: projects } = await togglClient.get(`clients/${clientId}/projects`);
  const { id: pid } = _.find(projects, ['name', 'Ounass']);
  const { data: tasks } = await togglClient.get(`/projects/${pid}/tasks`);
  const { id: existingTaskId } = _.find(tasks, ['name', JIRATicketId]) || {};
  let tid = existingTaskId;
  console.log('Existing task id', tid);
  if (!existingTaskId) {
    const { data: { data: { id: newTaskId } } } = await togglClient.post('/tasks', {
      task: {
        name: JIRATicketId,
        pid,
      },
    });
    tid = newTaskId;
    console.log('New task id', tid);
  }
  console.log('Task id', tid);
  const { data: timeEntry } = await togglClient.post('/time_entries/start', {
    time_entry: {
      description: 'Reviewing',
      pid,
      tid,
      tags: ['Code Review'],
      created_with: 'curl',
    },
  });
  res.json(timeEntry);
});

app.get('/stopReview', async (req, res) => {
  await stopRunningTimeEntry();
  res.json({});
});

app.get('/declineMR/:JIRATicketId', async (req, res) => {
  try {
    await stopRunningTimeEntry({ description: 'Declined' });
  } catch (err) {}

  const { JIRATicketId } = req.params;
  const {
    data: {
      issues: [{
        changelog: { histories },
      }],
    },
  } = await JIRAClient.get('/search', {
    params: {
      jql: `key in ('${JIRATicketId}')`,
      expand: 'changelog',
      fields: 'status,assignee,transitions',
    },
  });
  const {
    author: {
      accountId,
    },
  } = histories.find(({ items }) => !!items.find(({ field, fromString, toString }) => (
    field === 'status' && fromString === 'Backlog' && toString === 'In Development'
  )));
  const { data: { transitions } } = await JIRAClient.get(`issue/${JIRATicketId}/transitions`);
  const { id: transitionId } = _.find(transitions, ['name', 'Code Review Failed'])
    || _.find(transitions, ['name', 'Decline'])
    || {};
  await JIRAClient.put(`/issue/${JIRATicketId}`, {
    update: {
      assignee: [
        { set: { id: accountId } },
      ],
    },
  });
  await JIRAClient.post(`/issue/${JIRATicketId}/transitions`, {
    transition: { id: transitionId },
  });

  res.json({});
});

app.get('/acceptMR/:JIRATicketId', async (req, res) => {
  await stopRunningTimeEntry({ description: 'Merged' });

  const { JIRATicketId } = req.params;
  const { data: [{ accountId }] } = await JIRAClient.get('/user/search?username=%rana waqar%');
  await JIRAClient.put(`/issue/${JIRATicketId}`, {
    update: {
      assignee: [
        { set: { id: accountId } },
      ],
      labels: [
        { add: 'nis-beta' },
      ],
    },
  });
  const { data: { transitions } } = await JIRAClient.get(`issue/${JIRATicketId}/transitions`);
  const { id: transitionId } = _.find(transitions, ['name', 'Accept']) || {};
  await JIRAClient.post(`/issue/${JIRATicketId}/transitions`, {
    transition: { id: transitionId },
  });

  res.json({});
});

const nextApp = next({ dev: process.env.NODE_ENV !== 'production' });
const nextRequestHandler = nextApp.getRequestHandler();

app.use((req, res) => {
  nextRequestHandler(req, res, parse(req.url, true));
});

app.use((err, req, res, next) => {
  console.log(err);
  res.status(500).send({ m: err.message, s: err.stack });
});

nextApp.prepare().then(() => {
  app.listen(port, (err) => {
    if (err) {
      throw err;
    }

    console.log('> ready on', port);
  });
});
