import React, {FunctionComponent} from 'react';

import { PpString, PpDisplay } from 'pp-display';

import classes from './ResultStatement.module.css';

type ResultStatementProps = {
    statement: PpString | null; 
    className?: string[];
};

const resultStatement: FunctionComponent<ResultStatementProps> = (props) => {
    
    const {statement, className} = props;

    const classNames = className ? className.concat([classes.ResultStatement]) : [classes.ResultStatement];
    
    return statement ?
        <span className={classNames.join(' ')}>
            <PpDisplay pp={statement} coqCss={classes} maxDepth={17}/>
        </span>
        : null;
    
};

export default resultStatement;