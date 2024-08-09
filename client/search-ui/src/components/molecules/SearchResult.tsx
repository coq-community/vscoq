import React, {FunctionComponent, useState} from 'react';

import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import {VscCopy, VscChevronDown, VscChevronRight, VscTrash, VscClose} from 'react-icons/vsc';
import { stringOfPpString } from 'pp-display';
import { CollapsibleSearchResult } from '../../types';
import ResultName from '../atoms/ResultName';
import ResultStatement from '../atoms/ResultStatement';

import classes from './SearchResult.module.css';

type SearchResultProps = {
    result: CollapsibleSearchResult;
    toggleCollapsedHandler: () => void;
    deleteResultHandler: () => void;
    copyNameHandler: (name: string) => void;
};

const searchResult: FunctionComponent<SearchResultProps> = (props) => {
    
    const {result, toggleCollapsedHandler, deleteResultHandler, copyNameHandler} = props;
    const {name, statement, collapsed} = result;

    const [hovered, setHovered] = useState(false);

    const classNames = hovered ? [classes.ResultHeader, classes.Hovered] : [classes.ResultHeader];
    const actionRowClasses = hovered ? [classes.ActionRow] : [classes.ActionRow, classes.Hidden];
    
    const chevron = collapsed ? <VscChevronRight className={classes.CollapseButton}/> 
    : <VscChevronDown className={classes.CollapseButton}/>;

    return (
        <div className={classes.ResultBlock}>
            
            <div className={classNames.join(' ')} 
                onMouseEnter={() => setHovered(true)} 
                onMouseLeave={() => setHovered(false)}
                onClick={toggleCollapsedHandler}
            >
                <div className={classes.Name}>
                    {chevron}
                    <ResultName name={name} />
                </div>
                <div className={actionRowClasses.join(' ')}>   
                    <VSCodeButton appearance={'icon'} ariaLabel='Copy' onClick={(event) => {
                        event.stopPropagation();
                        copyNameHandler(stringOfPpString(name));
                    }}>
                        <VscCopy />
                    </VSCodeButton>
                    <VSCodeButton appearance={'icon'} ariaLabel='Remove' onClick={(event) => {
                        event.stopPropagation();
                        deleteResultHandler();
                    }}>
                        <VscClose />
                    </VSCodeButton>    
                </div>
            </div>
            
            <ResultStatement className={collapsed ? [classes.Collapsed] : []} statement={statement}/>

        </div>
    );
};

export default searchResult;