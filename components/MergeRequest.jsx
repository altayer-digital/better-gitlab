/* eslint-disable react/prop-types */
import moment from 'moment';
import React from 'react';
import AuthorAvatar from './AuthorAvatar';
import './MergeRequest.less';

const MergeRequest = ({
  // text 1
  title,
  gitlabUrl,

  // text 2
  mrId,
  createdAt,
  author: {
    name: openedBy,
    avatarUrl,
  },
  targetBranch,

  // text 3 & 4
  JIRATicketId,
  JIRA: {
    summary = '',
    webUrl,
    issueType,
    priority,
    status,
    reporter,
    timeSpent = 0,
  } = {},

  // icons 1
  upVoteAuthors = [],
  upVotes,
  upVotedByMe,

  // icons 2
  commentAuthors = [],
  numberOfComments,
  hasUnresolvedDiscussions,

  // icons 3
  filesChanged,
  linesAdded,
  linesRemoved,

  // icons 4
  updatedAt,
}) => (
  <li
    key={mrId}
    className={`MR ${JIRATicketId ? '' : 'MR-withoutJIRATicketId'}`}
  >
    <div className="MR-text">
      <a
        href={gitlabUrl}
        rel="noopener noreferrer"
        target="_blank"
        className="MR-title"
      >
        {title}
      </a>

      <div className="MR-line">
        <span className="MR-id">{mrId}</span>
        <u>opened</u>
        <span>{moment(createdAt).fromNow()}</span>
        <span>by</span>
        <AuthorAvatar avatarUrl={avatarUrl} />
        <span className="MR-openedBy">{openedBy}</span>

        <i className="fa fa-code-branch" />
        <span className="MR-targetBranch">{targetBranch}</span>
      </div>

      {issueType && (
        <a
          href={webUrl}
          rel="noopener noreferrer"
          target="_blank"
          className="MR-title"
        >
          {summary}
        </a>
      )}

      {issueType && (
        <div className="MR-line">
          <img alt="" src={issueType && issueType.iconUrl} />
          <span>{issueType && issueType.name}</span>

          <img alt="" src={priority && priority.iconUrl} style={{ width: 16 }} />
          <span>{priority && priority.name}</span>

          <span
            className="MR-JIRAStatus"
            style={status === 'Closed' ? { backgroundColor: 'green' } : {}}
          >
            {status}
          </span>

          <u>reported by</u>
          <AuthorAvatar avatarUrl={reporter && reporter.avatarUrls['48x48']} />
          <span className="MR-JIRAReporterName">{reporter && reporter.displayName}</span>
        </div>
      )}
    </div>

    <div className="MR-icons">
      <div className="MR-line">
        {upVoteAuthors.map(({ avatarUrl }) => (
          <AuthorAvatar key={avatarUrl} avatarUrl={avatarUrl} />
        ))}

        <i className="fa fa-thumbs-up" style={upVotedByMe ? { color: 'gold' } : {}} />
        <span>{upVotes}</span>
      </div>

      <div className="MR-line">
        {commentAuthors.map(({ avatarUrl }) => (
          <AuthorAvatar key={avatarUrl} avatarUrl={avatarUrl} />
        ))}

        <i className="fa fa-comments" style={hasUnresolvedDiscussions ? { color: 'red' } : {}} />
        <span>{numberOfComments}</span>
      </div>

      <div className="MR-line">
        <i className="fa fa-copy" />
        <span>{filesChanged}</span>

        <i className="far fa-plus-square" style={{ color: '#168f48' }} />
        <span>{linesAdded}</span>

        <i className="far fa-minus-square" style={{ color: '#db3b21' }} />
        <span>{linesRemoved}</span>
      </div>

      <div className="MR-line">
        <i className="fa fa-pen" />
        <span className="MR-updatedAt">{moment(updatedAt).fromNow()}</span>

        {issueType && timeSpent > 0 && (
          <React.Fragment>
            <i className="fa fa-clock" />
            <span className="MR-timeSpent">{moment.duration(timeSpent * 1000).humanize()}</span>
          </React.Fragment>
        )}
      </div>
    </div>
  </li>
);

export default MergeRequest;
