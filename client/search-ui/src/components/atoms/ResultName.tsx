import React, {FunctionComponent} from 'react';

import { PpString, PpDisplay } from 'pp-display';

import classes from './ResultName.module.css';

type ResultNameProps = {
    name: PpString; 
};

const resultName: FunctionComponent<ResultNameProps> = (props) => {
    
    const {name} = props;
    
    return <PpDisplay pp={name} coqCss={classes} maxDepth={17}/>;
    
};

export default resultName;