//Full meeting-history page: the same persisted list + drawer as Home.

import React from "react";
import { useHistory } from "react-router-dom";

import { useAuth } from "../AuthContext";
import RecentMeetings from "../components/RecentMeetings";
import "./Home.css";

const History = () => {
  const history = useHistory();
  const { user } = useAuth();

  return (
    <div className="hm-page">
      <header className="hm-header">
        <div className="ct-wordmark">
          <div className="ct-mark">
            <div className="ct-mark-dot ct-mark-dot--blue" />
            <div className="ct-mark-dot ct-mark-dot--coral" />
          </div>
          <span className="ct-wordmark-text">
            Connect<span>.Two</span>
          </span>
        </div>
        <button className="hm-join" onClick={() => history.push("/home")} type="button">
          <span className="msr">arrow_back</span>
          Home
        </button>
      </header>

      <main className="hm-main">
        <div className="hm-greeting">
          <h1 className="hm-h1">Meeting history</h1>
          <p className="hm-sub">Every call, its summary, and your action items.</p>
        </div>
        <RecentMeetings myName={user?.name} />
      </main>
    </div>
  );
};

export default History;
