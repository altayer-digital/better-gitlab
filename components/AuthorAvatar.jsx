import React from 'react';
import './AuthorAvatar.less';


const AuthorAvatar = ({ avatarUrl }) => (
  <img
    className="AuthorAvatar"
    alt={avatarUrl}
    src={avatarUrl}
  />
);

export default AuthorAvatar;
