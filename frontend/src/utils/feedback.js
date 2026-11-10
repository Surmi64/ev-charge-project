// The words the feedback page and the admin inbox share, so a status reads the same
// to the person who sent it and to the person answering it.
export const FEEDBACK_KINDS = {
  idea: { label: 'Idea', hint: 'Something Mileage should do, or do differently.' },
  bug: { label: 'Bug report', hint: 'Something that does not work as it should. Say what you did and what happened.' },
  complaint: { label: 'Complaint', hint: 'About billing or the service. You get a written answer within 30 days.' },
};

export const FEEDBACK_STATUS = {
  new: { label: 'Received', color: 'default' },
  in_progress: { label: 'Being looked at', color: 'info' },
  planned: { label: 'Planned', color: 'info' },
  answered: { label: 'Answered', color: 'success' },
  resolved: { label: 'Resolved', color: 'success' },
  declined: { label: 'Closed', color: 'default' },
};
