Better Gitlab
===
This project aims at improving Gitlab & JIRA integration, by enriching gitlab views with information from JIRA.

Tested on node version 11.12.0

## MR List view
It adds the following to the gitlab merge request list view:
- JIRA ticket info such as issueType, priority, status & reporter.
- displays the avatars of authors who upvoted the mr.
- highlights thumbsup icon in yellow if the mr is upVoted by config.gitlabUsername.
- displays the avatars of authors who commented on the mr.
- highlights comments icon in red if the mr has unresolved discussions opened by config.gitlabUsername.
- \# of files changed.
- \# of lines added.
- \# of lines removed.
- amount of time spent on ticket by entire team (as seen in tempo worklogs on JIRA).
- ability to filter / sort by all the information mentioned above using JavaScript.

## Setup
create `config/user.yml` with the following information:
```
JIRAAPIBaseURL: ''
JIRAWebBaseURL: ''
JIRAUser: ''
JIRAAPIToken: ''

gitlabProjectId: 0
gitlabUsername: ''
gitlabAccessToken: ''
```

Next run the following from terminal under project directory:
```sh
yarn install
yarn 
start
visit http://localhost:3000
```