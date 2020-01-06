import axios from 'axios';
import { get, orderBy } from 'lodash';
import React from 'react';
import MergeRequest from '../components/MergeRequest';
import './index.less';

// to prevent loading entire lodash
Array.prototype.orderBy = function(...args) {
  return orderBy(this, ...args);
}

class App extends React.PureComponent {
  state = {
    filterScript: '',
    filterScripts: [{
      name: 'Low hanging fruit',
      script: `mr.linesAdded <= 20
&& this.get(mr, 'JIRA.status', '') === 'In Code Review'
&& !mr.hasUnresolvedDiscussions
&& !mr.upVotedByMe`,
    }, {
      name: 'Unresolved comments done',
      script: `!!mr.hasUnresolvedDiscussions && this.get(mr, 'JIRA.status', '') === 'In Code Review'`
    }, {
      name: 'Unresolved comments pending',
      script: `!!mr.hasUnresolvedDiscussions && this.get(mr, 'JIRA.status', '') !== 'In Code Review'`
    }, {
      name: 'Has my blessing',
      script: '!!mr.upVotedByMe'
    }, {
      name: 'Not reviewed by me',
      script: '!!mr.JIRATicketId && !mr.hasUnresolvedDiscussions && !mr.upVotedByMe'
    }, {
      name: 'Not in code review',
      script: `!!mr.JIRATicketId && this.get(mr, 'JIRA.status', '') !== 'In Code Review'`
    }, {
      name: 'Without JIRATicketId',
      script: `!mr.JIRATicketId`,
    }],
    selectedFilterScript: -1,
    issues: {},
    changes: {},
    comments: {},
    votes: {},
    mrs: [],
    sortBy: 'createdAt',
    sortDirection: 'desc',
  }

  async componentDidMount() {
    const { data: mrs } = await axios.get('/mrs');
    this.setState({ mrs });

    // enrich data & update UI in parallel
    [{
      key: 'issues',
      mrs: mrs
        .map(({ JIRATicketId }) => JIRATicketId)
        .filter(Boolean)
    }, {
      key: 'changes',
      mrs: mrs.map(({ mrId }) => mrId),
    }, {
      key: 'comments',
      mrs: mrs
        .filter(({ numberOfComments }) => numberOfComments > 0)
        .map(({ mrId }) => mrId),
    }, {
      key: 'votes',
      mrs: mrs
        .filter(({ upVotes }) => upVotes > 0)
        .map(({ mrId }) => mrId),
    }].map(({ key, mrs }) =>
      axios
        .get(`/${key}`, {
          params: { mrs },
        })
        .then(({ data }) => this.setState({ [key]: data })));
  }

  render() {
    const {
      issues,
      changes,
      comments,
      votes,
      sortBy,
      sortDirection,
      filterScript,
      filterScripts,
      selectedFilterScript,
    } = this.state;

    const mrs = this.state.mrs
      .map(({ mrId, JIRATicketId, ...rest }) => ({
        mrId,
        JIRATicketId,
        JIRA: issues[JIRATicketId] || {},
        ...(comments[mrId] || {}),
        ...(changes[mrId] || {}),
        ...(votes[mrId] || {}),
        ...rest,
      }))
      .orderBy([sortBy], [sortDirection])
      .filter((mr) => {
        let result;
        try {
          result = eval(`(function f(mr) { return ${filterScript} })`).call({ get }, mr);
        } catch (err) {}
        return typeof result === 'boolean' ? result : true;
      });

    return (
      <div className="App">
        <div className="App-openMergeRequests">
          <span>Open</span>

          <span className="App-openMergeRequestsCount">
            {mrs.length}
          </span>
        </div>

        <form className="App-mrSearchForm">
          <select
            className="App-mrSearchPresets"
            value={selectedFilterScript}
            onChange={({ target: { value } }) => this.setState({
              selectedFilterScript: value,
              filterScript: get(filterScripts, [value, 'script'], ''),
            })}
          >
            <option>Select from search presets</option>
            {filterScripts.map(({ name }, index) => (
              <option
                key={name}
                value={index}
              >
                {name}
              </option>
            ))}
          </select>

          <textarea
            className="App-mrFilterScript"
            placeholder={'Filter script goes here...'}
            value={filterScript}
            onChange={({ target: { value } }) => this.setState({ filterScript: value })}
          />

          <select
            className="App-mrSortBy"
            value={sortBy}
            onChange={({ target: { value } }) => this.setState({ sortBy: value })}
          >
            {[
              'createdAt',
              'updatedAt',
              'filesChanged',
              'linesAdded',
              'JIRA.timeSpent',
              'JIRA.priority.name',
              'numberOfComments',
            ].map(field => (
              <option
                key={field}
                value={field}
              >
                {field}
              </option>
            ))}
          </select>

          <button
            className="App-mrSortDirection"
            value={sortDirection}
            onClick={(e) => {
              e.preventDefault();
              this.setState({
                sortDirection: sortDirection === 'asc' ? 'desc' : 'asc',
              })
            }}
          >
            <i className={`fa fa-sort-amount-${sortDirection === 'asc' ? 'up' : 'down'}`} />
          </button>
        </form>

        <ul className="App-mergeRequests">
          {mrs.map(({ mrId, ...rest }) => (
            <MergeRequest
              key={mrId}
              mrId={mrId}
              {...rest}
            />
          ))}
        </ul>
      </div>
    );
  }
}

export default App